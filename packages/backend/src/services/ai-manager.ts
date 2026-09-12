import { PrismaClient } from '@prisma/client'
import { encryptApiKey, decryptApiKey, maskApiKey } from '../utils/encryption'

const prisma = new PrismaClient()

export async function getProviders() {
  const providers = await prisma.aiProvider.findMany({ orderBy: { name: 'asc' } })
  return providers.map(p => ({
    ...p,
    apiKey: maskApiKey(p.apiKey),
  }))
}

export async function createProvider(data: {
  name: string; baseUrl: string; apiKey: string; model: string
  type?: string; headers?: string | Record<string, string>; collegeId?: string
}) {
  const encrypted = encryptApiKey(data.apiKey)
  // Order 9: headers is Json — normalize String → object for DB.
  const normHeaders: Record<string, string> | undefined = (data as any).headers === undefined ? undefined : (typeof (data as any).headers === 'string' ? (() => { try { return JSON.parse((data as any).headers || '{}') } catch { return {} } })() : (data as any).headers)
  const provider = await prisma.aiProvider.create({
    data: { ...data, ...(normHeaders !== undefined ? { headers: normHeaders as any } : {}), apiKey: encrypted },
  })
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

export async function updateProvider(id: string, data: {
  name?: string; baseUrl?: string; apiKey?: string; model?: string
  type?: string; headers?: string | Record<string, string>
}) {
  const updateData: any = { ...data }
  // Order 9: normalize headers String → object for Json col.
  if (typeof updateData.headers === 'string') { try { updateData.headers = JSON.parse(updateData.headers || '{}') } catch { updateData.headers = {} } }
  if (data.apiKey) updateData.apiKey = encryptApiKey(data.apiKey)
  const provider = await prisma.aiProvider.update({ where: { id }, data: updateData })
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

export async function deleteProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (provider?.isBuiltIn) throw new Error('Cannot delete built-in provider')
  await prisma.aiRouting.deleteMany({ where: { providerId: id } })
  await prisma.aiProvider.delete({ where: { id } })
}

export async function toggleProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (!provider) throw new Error('Provider not found')
  const updated = await prisma.aiProvider.update({
    where: { id },
    data: { enabled: !provider.enabled },
  })
  return { ...updated, apiKey: maskApiKey(updated.apiKey) }
}

export async function testProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (!provider) throw new Error('Provider not found')
  let apiKey: string
  try {
    apiKey = decryptApiKey(provider.apiKey)
  } catch {
    return { success: false, error: 'API key is not configured or invalid. Please update the provider with a valid API key.', latency: 0 }
  }
  const start = Date.now()

  try {
    const baseUrl = provider.baseUrl.replace(/\/+$/, '')
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(typeof (provider as any).headers === 'string' ? JSON.parse((provider as any).headers || '{}') : ((provider as any).headers ?? {})),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Say "Hello! I am working correctly."' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      const err = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${err}`, latency: Date.now() - start }
    }

    const data = await response.json() as any
    const text = data.choices?.[0]?.message?.content || 'No response'
    return { success: true, latency: Date.now() - start, model: provider.model, response: text }
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection failed', latency: Date.now() - start }
  }
}

export async function getRouting() {
  const routing = await prisma.aiRouting.findMany()
  return routing
}

export async function updateRouting(feature: string, providerIds: (string | null)[]) {
  await prisma.aiRouting.deleteMany({ where: { feature } })
  const creates = providerIds
    .map((providerId, index) => providerId ? { feature, providerId, fallbackOrder: index } : null)
    .filter(Boolean)
  if (creates.length > 0) {
    await prisma.aiRouting.createMany({ data: creates as any })
  }
}

export interface ManagedProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  type: string
  headers: Record<string, string>
}

/**
 * True when a baseUrl points at the local machine (unreachable on hosted production deploys).
 */
function isLocalhostBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

/**
 * Ordered list of enabled providers routed to a feature.
 * Capability support is modeled by AiRouting rows (feature -> providerId).
 * In production, localhost providers are skipped unless they are the only option;
 * runtime failover still handles them failing.
 */
export async function getProvidersForFeature(feature: string): Promise<ManagedProvider[]> {
  const routing = await prisma.aiRouting.findMany({
    where: { feature },
    orderBy: { fallbackOrder: 'asc' },
  })

  const candidates: Array<ManagedProvider & { fallbackOrder: number; createdAt: Date }> = []
  for (const r of routing) {
    const provider = await prisma.aiProvider.findUnique({ where: { id: r.providerId } })
    if (!provider?.enabled) continue
    let decryptedKey: string
    try {
      decryptedKey = decryptApiKey(provider.apiKey)
    } catch {
      continue
    }
    let headers: Record<string, string>
    try {
      headers = (typeof (provider as any).headers === 'string' ? JSON.parse((provider as any).headers || '{}') : ((provider as any).headers ?? {}))
    } catch {
      continue
    }
    candidates.push({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: decryptedKey,
      model: provider.model,
      type: provider.type,
      headers,
      fallbackOrder: r.fallbackOrder,
      createdAt: provider.createdAt,
    })
  }

  // Production safety: localhost providers are unreachable on hosted deploys —
  // skip them at selection time unless they are the only option.
  let eligible = candidates
  if (process.env.NODE_ENV === 'production') {
    const remote = candidates.filter(c => !isLocalhostBaseUrl(c.baseUrl))
    if (remote.length > 0) eligible = remote
  }

  // Deterministic order: admin-configured fallbackOrder first, stable tie-breaks after.
  eligible.sort((a, b) =>
    a.fallbackOrder - b.fallbackOrder ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.name.localeCompare(b.name),
  )

  return eligible.map(c => ({
    id: c.id,
    name: c.name,
    baseUrl: c.baseUrl,
    apiKey: c.apiKey,
    model: c.model,
    type: c.type,
    headers: c.headers,
  }))
}

export async function getProviderForFeature(feature: string): Promise<{
  baseUrl: string; apiKey: string; model: string; type: string; headers: Record<string, string>
} | null> {
  const providers = await getProvidersForFeature(feature)
  return providers[0] ?? null
}

export async function getDecryptedKey(id: string): Promise<string> {
  const p = await prisma.aiProvider.findUnique({ where: { id } })
  if (!p) throw new Error('Provider not found')
  try {
    return decryptApiKey(p.apiKey)
  } catch {
    throw new Error('API key is not configured or invalid')
  }
}
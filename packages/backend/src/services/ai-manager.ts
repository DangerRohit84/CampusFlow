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
  type?: string; headers?: string; collegeId?: string
}) {
  const encrypted = encryptApiKey(data.apiKey)
  const provider = await prisma.aiProvider.create({
    data: { ...data, apiKey: encrypted },
  })
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

export async function updateProvider(id: string, data: {
  name?: string; baseUrl?: string; apiKey?: string; model?: string
  type?: string; headers?: string
}) {
  const updateData: any = { ...data }
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
        ...JSON.parse(provider.headers || '{}'),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Say "Hello! I am working correctly."' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(10000),
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

export async function getProviderForFeature(feature: string): Promise<{
  baseUrl: string; apiKey: string; model: string; type: string; headers: Record<string, string>
} | null> {
  const routing = await prisma.aiRouting.findMany({
    where: { feature },
    orderBy: { fallbackOrder: 'asc' },
  })

  for (const r of routing) {
    const provider = await prisma.aiProvider.findUnique({ where: { id: r.providerId } })
    if (provider?.enabled) {
      let decryptedKey: string
      try {
        decryptedKey = decryptApiKey(provider.apiKey)
      } catch {
        continue
      }
      return {
        baseUrl: provider.baseUrl,
        apiKey: decryptedKey,
        model: provider.model,
        type: provider.type,
        headers: JSON.parse(provider.headers || '{}'),
      }
    }
  }
  return null
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
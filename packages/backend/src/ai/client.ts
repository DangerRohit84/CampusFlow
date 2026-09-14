import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import { getProvidersForFeature } from '../services/ai-manager'
import { config } from '../config'
import { logger } from '../utils/logger'

export interface AIProvider {
  id?: string
  name?: string
  baseUrl: string
  apiKey: string
  model: string
  type: string
  headers: Record<string, string>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{
    type: string
    text?: string
    image_url?: { url: string }
    // Accepted on input (e.g. Anthropic-style parts); normalized to image_url below.
    source?: { type?: string; media_type?: string; mimeType?: string; data?: string; url?: string }
  }>
}

// ---------------------------------------------------------------------------
// Vision normalization (fix: timetable upload reached the model as text-only).
// Root cause: provider branches handled image parts inconsistently —
// callAnthropic replaced every image with the literal text "[image]", and
// callGoogle assumed data-URLs (http URLs produced `data: undefined`).
// A text-only request makes the model truthfully reply "I don't see an image
// attached" (~196 chars), which then fails JSON parsing → 0 periods parsed.
// Contract now: vision calls ALWAYS carry the image inline as a base64
// data-URL (downscaled when huge) regardless of provider; publicly-reachable
// http(s) URLs are kept as-is as a fallback for the model host to fetch.
// ---------------------------------------------------------------------------

const VISION_MAX_DIM = 1568
const VISION_MAX_BYTES = 900_000

async function getSharp(): Promise<any | null> {
  try {
    const mod = await import('sharp')
    return (mod as any)?.default ?? mod
  } catch {
    return null
  }
}

function parseImageDataUrl(url: string): { mime: string; data: string } | null {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null
  const comma = url.indexOf(',')
  if (comma === -1) return null
  const head = url.slice(5, comma) // e.g. "image/png;base64"
  if (!/;base64$/i.test(head)) return null
  const data = url.slice(comma + 1)
  if (!data) return null
  const mime = head.slice(0, head.length - ';base64'.length).trim() || 'image/jpeg'
  return { mime, data }
}

/**
 * Downscale a base64 data-URL image when it is huge (pixel dims or byte
 * size), so OpenAI-compatible gateways (incl. OpenCode Serve) don't truncate
 * or drop the image part. Non-data URLs pass through untouched. Never throws
 * — returns the original URL when sharp is unavailable or input is unusual.
 */
export async function maybeDownscaleDataUrl(url: string): Promise<string> {
  const parsed = parseImageDataUrl(url)
  if (!parsed) return url
  let buf: Buffer
  try {
    buf = Buffer.from(parsed.data, 'base64')
  } catch {
    return url
  }
  if (buf.length === 0) return url
  const sharp = await getSharp()
  if (!sharp) return url
  try {
    const meta = await sharp(buf, { failOn: 'none' }).metadata()
    const overDim =
      (typeof meta.width === 'number' && meta.width > VISION_MAX_DIM) ||
      (typeof meta.height === 'number' && meta.height > VISION_MAX_DIM)
    if (!overDim && buf.length <= VISION_MAX_BYTES) return url
    const out = await sharp(buf, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: VISION_MAX_DIM, height: VISION_MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    if (!out || out.length === 0) return url
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch {
    return url
  }
}

/**
 * Canonicalize content parts to OpenAI shape: `{type:'image', ...}` variants
 * become `{type:'image_url', image_url:{url}}` with an inline data-URL when
 * the bytes are available (Anthropic-style base64 source). Plain http(s)
 * URLs are kept as-is (publicly-reachable fallback).
 */
export function canonicalizeContentParts(
  content: ChatMessage['content'],
): ChatMessage['content'] {
  if (typeof content === 'string' || !Array.isArray(content)) return content
  return content.map((p: any) => {
    if (!p || typeof p !== 'object') return p
    if (p.type === 'text' || p.type === 'image_url') return p
    if (p.type === 'image') {
      const direct = p.image_url?.url ?? p.source?.url ?? p.url
      if (typeof direct === 'string' && direct) {
        return { type: 'image_url', image_url: { url: direct } }
      }
      const src = p.source
      if (src && typeof src.data === 'string' && src.data) {
        const mime = src.media_type || src.mimeType || 'image/jpeg'
        return { type: 'image_url', image_url: { url: `data:${mime};base64,${src.data}` } }
      }
    }
    return p
  })
}

/**
 * Full vision normalization: canonical part types + inline data-URL bytes
 * (downscaled when huge) for every provider branch.
 */
export async function normalizeVisionMessages(messages: ChatMessage[]): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      const content = canonicalizeContentParts(m.content)
      if (typeof content === 'string' || !Array.isArray(content)) return { ...m, content }
      const out = await Promise.all(
        content.map(async (p: any) => {
          if (p?.type === 'image_url' && typeof p?.image_url?.url === 'string') {
            const url = await maybeDownscaleDataUrl(p.image_url.url)
            return url === p.image_url.url ? p : { type: 'image_url', image_url: { url } }
          }
          return p
        }),
      )
      return { ...m, content: out }
    }),
  )
}

/**
 * Map normalized messages to Anthropic blocks. Images are sent as REAL image
 * blocks (base64 or url source) — never the "[image]" text placeholder that
 * caused "I don't see an image attached".
 */
export function toAnthropicMessages(messages: ChatMessage[]): any[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (typeof m.content === 'string') return { role: m.role, content: m.content }
      const blocks: any[] = (canonicalizeContentParts(m.content) as any[]).flatMap((p: any): any[] => {
        if (!p || typeof p !== 'object') return []
        if (p.type === 'text') return [{ type: 'text', text: p.text || '' }]
        if (p.type === 'image_url' && typeof p.image_url?.url === 'string') {
          const url: string = p.image_url.url
          const parsed = parseImageDataUrl(url)
          if (parsed) {
            return [{ type: 'image', source: { type: 'base64', media_type: parsed.mime, data: parsed.data } }]
          }
          return [{ type: 'image', source: { type: 'url', url } }]
        }
        return []
      })
      return { role: m.role, content: blocks.length > 0 ? blocks : '' }
    })
}

const NOT_CONFIGURED_MESSAGE = 'AI provider not configured. Please set up a provider in AI Manager.'

function hasUsableKey(provider: AIProvider): boolean {
  return Boolean(provider.apiKey) && provider.apiKey !== 'your-groq-api-key-here'
}

/**
 * Get ordered failover candidates for a feature. Falls back to hardcoded Groq
 * if no AI Manager provider is configured/routable.
 */
async function resolveProviders(feature: string): Promise<AIProvider[]> {
  const managed = await getProvidersForFeature(feature).catch(() => [])
  if (managed.length > 0) return managed

  // Fallback to hardcoded Groq
  return [{
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: config.groqApiKey,
    model: 'openai/gpt-oss-120b',
    type: 'openai-compatible',
    headers: {},
  }]
}

// Per-user Groq key + global model (superadmin AI Manager) helpers
async function resolveProvidersWithUserKey(feature: string, userApiKey: string): Promise<AIProvider[]> {
  const trimmedKey = String(userApiKey || '').trim()
  if (!trimmedKey) return []
  const managed = await getProvidersForFeature(feature).catch(() => [])
  // Try vision-specific routing first for vision feature
  const baseCandidates = managed.length ? managed : []
  if (baseCandidates.length) {
    // Clone with user key, keep global model/baseUrl/headers
    return baseCandidates.map(p => ({ ...p, apiKey: trimmedKey }))
  }
  // No managed provider — create synthetic using global defaults but user key
  const isVisionLike = feature.includes('vision') || feature === 'resume'
  // For resume feature, superadmin's global text model is gpt-oss-120b, vision is qwen/qwen3-32b
  const fallbackModel = isVisionLike && feature.includes('vision') ? 'qwen/qwen3-32b' : 'openai/gpt-oss-120b'
  // If feature is plain 'resume', vision calls will still use qwen default if no provider
  const visionModel = 'qwen/qwen3-32b'
  const textModel = 'openai/gpt-oss-120b'
  const chosen = feature.includes('vision') ? visionModel : (feature === 'resume' ? textModel : fallbackModel)
  // For resume we will let caller decide vision vs text by passing feature 'resume-vision' vs 'resume'
  // Provide both synthetic options if needed — caller picks feature
  return [{
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: trimmedKey,
    model: chosen,
    type: 'openai-compatible',
    headers: {},
  }]
}

async function executeWithFailoverWithUserKey(
  feature: string,
  messages: ChatMessage[],
  userApiKey: string,
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  const trimmed = String(userApiKey || '').trim()
  if (!trimmed) return NOT_CONFIGURED_MESSAGE
  // Build candidates with user key but global model/baseUrl
  const candidates = await resolveProvidersWithUserKey(feature, trimmed)
  let lastError: unknown
  let hadUsableKey = false
  for (const provider of candidates) {
    if (!hasUsableKey(provider)) continue
    hadUsableKey = true
    const label = provider.name || provider.baseUrl
    try {
      const result = await callProvider(provider, messages, options)
      logger.info(`AI request [${feature}] (user key) served by provider "${label}" (${provider.model})`)
      return result
    } catch (error: any) {
      lastError = error
      logger.error({ err: error?.message || error }, `AI provider (user key) "${label}" failed for [${feature}], trying next`)
    }
  }
  if (!hadUsableKey) return NOT_CONFIGURED_MESSAGE
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'All AI providers failed (user key)'))
}

/**
 * Try each candidate provider exactly once, in deterministic order, until one succeeds.
 * Logs which provider ultimately served the request; when every candidate fails,
 * rethrows the last error (same error shape as a single-provider call).
 */
async function executeWithFailover(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  const candidates = await resolveProviders(feature)
  let lastError: unknown
  let hadUsableKey = false

  for (const provider of candidates) {
    if (!hasUsableKey(provider)) continue
    hadUsableKey = true
    const label = provider.name || provider.baseUrl
    try {
      const result = await callProvider(provider, messages, options)
      logger.info(`AI request [${feature}] served by provider "${label}" (${provider.model})`)
      return result
    } catch (error: any) {
      lastError = error
      logger.error({ err: error?.message || error }, `AI provider "${label}" failed for [${feature}], trying next candidate`)
    }
  }

  if (!hadUsableKey) return NOT_CONFIGURED_MESSAGE
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'All AI providers failed'))
}

/**
 * Convert ChatMessage[] to plain text prompt (used for non-OpenAI providers).
 */
function messagesToPrompt(messages: ChatMessage[]): string {
  return messages.map(m => {
    if (typeof m.content === 'string') return `${m.role}: ${m.content}`
    // For vision messages, extract text parts only
    if (Array.isArray(m.content)) {
      const textParts = m.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
      return `${m.role}: ${textParts}`
    }
    return ''
  }).join('\n\n')
}

/**
 * Call Google Gemini API.
 */
async function callGoogle(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }): Promise<string> {
  const genAI = new GoogleGenerativeAI(provider.apiKey)
  const model = genAI.getGenerativeModel({ model: provider.model })

  // Extract system instruction if present
  const systemMsg = messages.find(m => m.role === 'system')
  const userMessages = messages.filter(m => m.role !== 'system')

  const genOpts: any = {
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.max_tokens ?? 1024,
    },
  }
  if (systemMsg && typeof systemMsg.content === 'string') {
    genOpts.systemInstruction = systemMsg.content
  }

  // Handle vision messages
  const lastUserMsg = userMessages[userMessages.length - 1]
  if (lastUserMsg && Array.isArray(lastUserMsg.content)) {
    const parts = (canonicalizeContentParts(lastUserMsg.content) as any[]).map((p: any) => {
      if (p.type === 'text') return { text: p.text }
      if (p.type === 'image_url' && p.image_url?.url) {
        const url: string = p.image_url.url
        const parsed = parseImageDataUrl(url)
        if (parsed) {
          return { inlineData: { data: parsed.data, mimeType: parsed.mime } }
        }
        // Publicly-reachable URL fallback — model host fetches it.
        return { fileData: { mimeType: 'image/jpeg', fileUri: url } }
      }
      return { text: '' }
    })
    const result = await model.generateContent({ contents: [{ role: 'user', parts }], ...genOpts })
    return result.response.text()
  }

  // Text-only messages
  const prompt = userMessages.map(m => typeof m.content === 'string' ? m.content : '').join('\n')
  const result = await model.generateContent(prompt, genOpts)
  return result.response.text()
}

/**
 * Call Anthropic API.
 */
async function callAnthropic(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }): Promise<string> {
  const client = new Anthropic({ apiKey: provider.apiKey })

  // Extract system message
  const systemMsg = messages.find(m => m.role === 'system')

  const anthropicMessages = toAnthropicMessages(messages)

  const result = await client.messages.create({
    model: provider.model,
    max_tokens: options?.max_tokens ?? 1024,
    temperature: options?.temperature ?? 0.7,
    system: systemMsg && typeof systemMsg.content === 'string' ? systemMsg.content : undefined,
    messages: anthropicMessages as any,
  })

  const textBlock = result.content.find((b: any) => b.type === 'text' && 'text' in b) as any
  return textBlock?.text || 'No response generated.'
}

/**
 * Call OpenAI-compatible API (Groq, OpenAI, DeepSeek, Mistral, etc.)
 *
 * P1-5: honors `options.model` when provided (extraction routes 20b for
 * enrich/ats-score via services/aiCache). Absent → provider.model (admin
 * AI-Manager config preserved, byte-identical behavior to today).
 */
async function callOpenAICompatible(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number; model?: string }): Promise<string> {
  // Normalize: trim copy-paste whitespace (adapter also strips, defense in depth)
  // so explicit IDs behave identically to `default`; bypass header matches the
  // proven-working curl (ngrok free edge needs it, harmless elsewhere, and
  // provider.headers still overrides when set).
  const baseUrl = String(provider.baseUrl ?? '').trim().replace(/\/+$/, '')
  // P1-5 model override (extraction → 20b): explicit caller model wins;
  // otherwise the provider's configured model (admin AI-Manager preserved).
  const overrideModel = String((options as { model?: string } | undefined)?.model ?? '').trim()
  const model = overrideModel || String(provider.model ?? '').trim()
  // Defensive: gateways (incl. OpenCode Serve) validate content-part variants
  // strictly — always send canonical OpenAI parts so the image isn't dropped.
  const wireMessages = messages.map(m => ({ ...m, content: canonicalizeContentParts(m.content) as any }))
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
        'ngrok-skip-browser-warning': 'true',
        ...(provider.headers ?? {}),
      },
      body: JSON.stringify({
        model,
        messages: wireMessages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 1024,
      }),
      signal: AbortSignal.timeout(60000),
    })
  } catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`OpenAI-compatible API request timed out after 60000ms`)
    }
    throw error
  }

  if (!response.ok) {
    const err = await response.text()
    const errorMessage = `OpenAI-compatible API error ${response.status}: ${err}`
    // Attach status for AI issue detection (Groq 429 TPM 8000)
    const error: any = new Error(errorMessage)
    error.status = response.status
    error.body = err
    throw error
  }

  const data = await response.json() as any
  return data.choices?.[0]?.message?.content || 'No response generated.'
}

/**
 * Route to correct provider based on type — OCP registry (Track 4: was a
 * switch on provider.type; adding a provider edited this function).
 * New provider type = one entry in PROVIDER_CALLS.
 */
type ProviderCall = (
  provider: AIProvider,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number; model?: string },
) => Promise<string>;

const PROVIDER_CALLS: Record<string, ProviderCall> = {
  google: callGoogle,
  anthropic: callAnthropic,
  'openai-compatible': callOpenAICompatible,
};

export function registerProviderCall(type: string, fn: ProviderCall): void {
  PROVIDER_CALLS[String(type || '').toLowerCase()] = fn;
}

async function callProvider(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number; model?: string }): Promise<string> {
  const key = String(provider?.type || '').toLowerCase();
  const fn = PROVIDER_CALLS[key] ?? PROVIDER_CALLS['openai-compatible'];
  return fn(provider, messages, options);
}

/**
 * Send chat completion request — auto-routes to correct provider with graceful failover.
 */
export async function chatCompletion(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  return executeWithFailover(feature, messages, options)
}

/**
 * Vision completion — supports image_url content type for image processing.
 * Normalizes every call to inline base64 data-URL bytes (downscaled when
 * huge) BEFORE provider failover, so all provider branches (OpenAI-
 * compatible incl. OpenCode Serve, Anthropic, Google) receive the image.
 */
export async function visionCompletion(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  const normalized = await normalizeVisionMessages(messages).catch(() => messages)
  return executeWithFailover(feature, normalized, { temperature: 0.1, max_tokens: 16384, ...options })
}

// Per-user Groq key variants — use user's API key but superadmin's global model (AI Manager)
export async function chatCompletionWithUserKey(
  feature: string,
  messages: ChatMessage[],
  userApiKey: string,
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  return executeWithFailoverWithUserKey(feature, messages, userApiKey, options)
}

export async function visionCompletionWithUserKey(
  feature: string,
  messages: ChatMessage[],
  userApiKey: string,
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  const normalized = await normalizeVisionMessages(messages).catch(() => messages)
  return executeWithFailoverWithUserKey(feature, normalized, userApiKey, { temperature: 0.1, max_tokens: 16384, ...options })
}

/**
 * Detect Groq 429 rate-limit (TPM 8000) — used to surface as AI issue not fetch failure.
 */
export function isAiRateLimitError(error: any): boolean {
  if (!error) return false
  const status = (error as any)?.status
  if (status === 429) return true
  const msg = String((error as any)?.message || error || '').toLowerCase()
  return msg.includes('429') || msg.includes('rate_limit_exceeded') || msg.includes('rate limit') || (msg.includes('tpm') && msg.includes('limit'))
}

/**
 * Build user-facing AI issue message for rate-limit.
 * Extracts retry seconds if present, else defaults to 5s.
 */
export function toAiIssueMessage(error: any): string {
  const raw = String((error as any)?.message || (error as any)?.body || error || '')
  let retrySec: number | null = null
  const m = raw.match(/try again in\s+([\d.]+)s/i) || raw.match(/retry.*?([\d.]+)\s*s/i) || raw.match(/in\s+([\d.]+)s/i)
  if (m) {
    const n = parseFloat(m[1])
    if (!isNaN(n) && n > 0 && n < 3600) retrySec = Math.ceil(n)
  }
  const waitPart = retrySec ? `, try again in ${retrySec}s` : `, try again in 5s`
  return `AI issue: Rate limit reached${waitPart}. Upgrade at https://console.groq.com/settings/billing`
}

/**
 * Convenience: single prompt → response.
 */
export async function aiChat(
  feature: string,
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  return chatCompletion(feature, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], options)
}

export async function aiChatWithUserKey(
  feature: string,
  systemPrompt: string,
  userMessage: string,
  userApiKey: string,
  options?: { temperature?: number; max_tokens?: number; model?: string },
): Promise<string> {
  return chatCompletionWithUserKey(feature, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], userApiKey, options)
}

import { GoogleGenerativeAI } from '@google/generative-ai'
import Anthropic from '@anthropic-ai/sdk'
import { getProvidersForFeature } from '../services/ai-manager'
import { config } from '../config'

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
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
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

/**
 * Try each candidate provider exactly once, in deterministic order, until one succeeds.
 * Logs which provider ultimately served the request; when every candidate fails,
 * rethrows the last error (same error shape as a single-provider call).
 */
async function executeWithFailover(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number },
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
      console.log(`AI request [${feature}] served by provider "${label}" (${provider.model})`)
      return result
    } catch (error: any) {
      lastError = error
      console.error(`AI provider "${label}" failed for [${feature}], trying next candidate:`, error?.message || error)
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
    const parts = lastUserMsg.content.map(p => {
      if (p.type === 'text') return { text: p.text }
      if (p.type === 'image_url' && p.image_url?.url) {
        const base64 = p.image_url.url.split(',')[1]
        const mimeType = p.image_url.url.match(/data:([^;]+)/)?.[1] || 'image/png'
        return { inlineData: { data: base64, mimeType } }
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
  const userMessages = messages.filter(m => m.role !== 'system')

  const anthropicMessages = userMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? { type: 'text' as const, text: p.text || '' } : { type: 'text' as const, text: '[image]' }),
  }))

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
 */
async function callOpenAICompatible(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }): Promise<string> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, '')
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
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
    throw new Error(`OpenAI-compatible API error ${response.status}: ${err}`)
  }

  const data = await response.json() as any
  return data.choices?.[0]?.message?.content || 'No response generated.'
}

/**
 * Route to correct provider based on type.
 */
async function callProvider(provider: AIProvider, messages: ChatMessage[], options?: { temperature?: number; max_tokens?: number }): Promise<string> {
  switch (provider.type) {
    case 'google':
      return callGoogle(provider, messages, options)
    case 'anthropic':
      return callAnthropic(provider, messages, options)
    case 'openai-compatible':
    default:
      return callOpenAICompatible(provider, messages, options)
  }
}

/**
 * Send chat completion request — auto-routes to correct provider with graceful failover.
 */
export async function chatCompletion(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number },
): Promise<string> {
  return executeWithFailover(feature, messages, options)
}

/**
 * Vision completion — supports image_url content type for image processing.
 */
export async function visionCompletion(
  feature: string,
  messages: ChatMessage[],
  options?: { temperature?: number; max_tokens?: number },
): Promise<string> {
  return executeWithFailover(feature, messages, { temperature: 0.1, max_tokens: 16384, ...options })
}

/**
 * Convenience: single prompt → response.
 */
export async function aiChat(
  feature: string,
  systemPrompt: string,
  userMessage: string,
  options?: { temperature?: number; max_tokens?: number },
): Promise<string> {
  return chatCompletion(feature, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ], options)
}

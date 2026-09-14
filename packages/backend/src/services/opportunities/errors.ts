// opportunities/errors.ts — AI rate-limit sentinel + availability gates (Track 4 C-3 split).
// WHY: AiRateLimitError/isRateLimitError/buildAiIssue/isGroqKeySet/
// isEnrichmentAIDisabled were buried in the god module but are needed by
// BOTH search extractors and enrich stages. Leaf module (no imports from
// sources/* or stages.ts) so neither direction cycles.
import { isAiRateLimitError, toAiIssueMessage } from '../../ai/client'
import { config } from '../../config'
import { GROQ_PLACEHOLDERS } from './sources/context'

// ─── AI rate-limit sentinel — enrich throws this so fetch routes can return AI issue not Fetch failed ───
export class AiRateLimitError extends Error {
  public retryAfter?: number
  constructor(message: string) {
    super(message)
    this.name = 'AiRateLimitError'
  }
}

export function isRateLimitError(err: any): boolean {
  return isAiRateLimitError(err)
}
export function buildAiIssue(err: any): string {
  return toAiIssueMessage(err)
}

// ─── AI availability helper — prevents infinite enrich loops when AI disabled ───
export function isGroqKeySet(): boolean {
  const k = (process.env.GROQ_API_KEY || config.groqApiKey || '').trim()
  return !!k && !GROQ_PLACEHOLDERS.has(k) && k.length > 10
}

export async function isEnrichmentAIDisabled(): Promise<boolean> {
  // P1-5 kill-switch first (global, logged at the caller): when ON, enrich
  // keeps its deterministic page-deadline path and skips Groq entirely.
  try {
    if (String(process.env.AI_KILL_SWITCH || '').trim().toLowerCase() === 'true') return true
  } catch {}
  if (isGroqKeySet()) return false
  try {
    const { getProvidersForFeature } = await import('../ai-manager')
    const providers = await getProvidersForFeature('enrichment')
    if (providers.length > 0) return false
  } catch {}
  return true
}

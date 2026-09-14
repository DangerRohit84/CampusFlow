/**
 * P1-5: AI prompt-cache structuring + small-model extraction + response cache
 * + batch ×10 + global kill-switch.
 *
 * WHY: AI is quota-guarded (100/day/user, 10k tokens/day/college, breaker)
 * but every identical enrich prompt re-bills Groq: prompts rebuild hints per
 * row (title/organizer/mode mixed order → 0% prefix-cache hits), 120b serves
 * 1k-token extraction, no response cache, no batch endpoint, and no global
 * kill-switch beyond the per-feature breaker. At 200 enrich/day this is
 * ~$0.10/day; burstable to ~$45/day at quota ceiling. This module:
 *  (a) Frozen prefix (`ENRICH_SYSTEM_PREFIX_V1`, exact bytes, versioned) +
 *      stable field order in `stagesPrompt.ts` → Groq auto prefix-cache hits.
 *  (b) `modelForFeature`: extraction (`enrichment`, `ats-score`) → 20b
 *      (2× cheaper, sufficient for JSON extraction); chat/study-plan stay on
 *      120b; vision stays on qwen. Override applies ONLY to the synthetic
 *      Groq fallback (no managed AI-Manager provider) — admin-configured
 *      models are never overridden.
 *  (c) `enrich:response:{model}:{prompt-sha}` 24h response cache (same
 *      prompt+model → same JSON, 0 Groq on reject→refetch cycles).
 *  (d) `AI_KILL_SWITCH=true` → deterministic fallback (503 at the quota
 *      middleware, empty-text + `killed:true` here so enrich keeps its
 *      deterministic page-deadline path). Breaker + quotas preserved.
 *  (e) `processEnrichBatch` (×10 windows, cache-aware delays): cached rows
 *      skip the inter-row Groq gap; misses keep it (TPM protection).
 *
 * CONTRACT (additive / backward-compat / fail-open):
 * - Cache miss / corrupt / Redis down → normal `chatCompletion` (old path).
 * - Kill-switch OFF (default) → byte-identical behavior to today.
 * - `enrichmentCompletion` returns `{text, cached, killed, model}`; callers
 *   that ignore the envelope keep working (stages returns `{cached}` which
 *   is assignable to the existing `Promise<void>` call sites).
 * - No prompt content is logged (hashes only). No secrets in keys.
 */

import crypto from 'crypto'
import { cache } from '../lib/cache'
import { chatCompletion } from '../ai/client'
import { memoizedSingleflight } from '../lib/singleflight'
import { logger } from '../utils/logger'

/**
 * Frozen enrich prompt version + prefix are canonical in
 * opportunities/stagesPrompt.ts (single source of truth — the builders emit
 * the prefix first). Re-exported here so enrich callers import ONE module.
 */
export { ENRICH_PROMPT_VERSION, ENRICH_SYSTEM_PREFIX_V1 } from './opportunities/stagesPrompt'
import { ENRICH_PROMPT_VERSION } from './opportunities/stagesPrompt'

/** Extraction model (2× cheaper than 120b, sufficient for JSON extraction). */
export const ENRICHMENT_MODEL_20B = 'openai/gpt-oss-20b'
/** Reasoning/chat model (unchanged default for chat/study-plan). */
export const CHAT_MODEL_120B = 'openai/gpt-oss-120b'
/** Vision model (unchanged). */
export const VISION_MODEL_QWEN = 'qwen/qwen3-32b'

/** 24h enrich response cache (same prompt+model re-enriched → 0 Groq). */
export const ENRICH_RESPONSE_TTL_MS = 24 * 60 * 60 * 1000

/** Batch window for cron enrichment (×10 rows per window, cache-aware gaps). */
export const ENRICH_BATCH_SIZE = 10

function shaHex(input: string): string {
  try {
    return crypto.createHash('sha256').update(String(input)).digest('hex')
  } catch {
    return 'error'
  }
}

/**
 * Route a feature to its cheapest sufficient model. Pure, never throws.
 * Extraction (enrichment, ats-score) → 20b; vision → qwen; everything else
 * (chat, study-plan, cover-letter, parse-vision) → 120b default.
 */
export function modelForFeature(feature: string): string {
  try {
    const f = String(feature || '').trim().toLowerCase()
    if (!f) return CHAT_MODEL_120B
    if (f.includes('vision')) return VISION_MODEL_QWEN
    if (f === 'enrichment' || f.startsWith('enrichment:') || f === 'ats-score' || f === 'ats_score') return ENRICHMENT_MODEL_20B
    return CHAT_MODEL_120B
  } catch {
    return CHAT_MODEL_120B
  }
}

/** Stable hash of an enrich prompt (dedup + cache key). Pure, never throws. */
export function enrichPromptHash(prompt: string): string {
  try {
    return shaHex(`${ENRICH_PROMPT_VERSION}:${String(prompt ?? '')}`)
  } catch {
    return 'error'
  }
}

/** Response-cache key (model sanitized — slashes → underscore). Pure. */
export function enrichResponseKey(model: string, promptHash: string): string {
  try {
    const m = String(model || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'unknown'
    const h = String(promptHash || 'empty').slice(0, 64) || 'empty'
    return `enrich:response:${m}:${h}`
  } catch {
    return 'enrich:response:unknown:empty'
  }
}

/** Global AI kill-switch (env). Pure, never throws. OFF by default. */
export function isAiKillSwitchOn(): boolean {
  try {
    return String(process.env.AI_KILL_SWITCH || '').trim().toLowerCase() === 'true'
  } catch {
    return false
  }
}

/** Read a cached enrich response. Miss/corrupt/error → null (normal Groq). */
export async function getCachedEnrichResponse(model: string, promptHash: string): Promise<string | null> {
  try {
    if (!promptHash || promptHash === 'error') return null
    const hit = await cache.get<string>(enrichResponseKey(model, promptHash))
    return typeof hit === 'string' && hit ? hit : null
  } catch {
    return null
  }
}

/** Write a cached enrich response (best-effort, never throws). */
export async function setCachedEnrichResponse(model: string, promptHash: string, text: string): Promise<void> {
  try {
    if (!promptHash || promptHash === 'error' || !text) return
    await cache.set(enrichResponseKey(model, promptHash), text, ENRICH_RESPONSE_TTL_MS)
  } catch {}
}

export interface EnrichmentCompletionResult {
  /** Model response text ('' when killed or empty — caller keeps deterministic path). */
  text: string
  /** True when served from the 24h response cache (0 Groq). */
  cached: boolean
  /** True when the global kill-switch suppressed the Groq call. */
  killed: boolean
  /** Model the call was routed to (observability). */
  model: string
}

/**
 * True when a managed AI-Manager provider exists for the feature (admin has
 * configured models → never override them with the 20b default).
 * Fail-open FALSE on any error (unknown → don't override = old behavior).
 */
async function hasManagedProvider(feature: string): Promise<boolean> {
  try {
    const { getProvidersForFeature } = await import('./ai-manager')
    const providers = await getProvidersForFeature(feature).catch(() => [])
    return Array.isArray(providers) && providers.length > 0
  } catch {
    return false
  }
}

export interface EnrichmentCompletionOptions {
  temperature?: number
  max_tokens?: number
  /** Explicit model override (tests + admin paths). Default: routed model. */
  model?: string
}

/**
 * Enrichment completion with kill-switch + 24h response cache + global
 * singleflight. Fail-open: any cache/Redis error → plain `chatCompletion`;
 * kill-switch ON → `{text:'', killed:true}` (caller keeps deterministic
 * page-deadline updates, no Groq spend); empty Groq text is NOT cached.
 */
export async function enrichmentCompletion(
  prompt: string,
  opts?: EnrichmentCompletionOptions,
): Promise<EnrichmentCompletionResult> {
  const routed = (() => {
    try {
      return (opts?.model || modelForFeature('enrichment')).trim() || ENRICHMENT_MODEL_20B
    } catch {
      return ENRICHMENT_MODEL_20B
    }
  })()
  if (isAiKillSwitchOn()) {
    try {
      logger.warn('[aiCache] AI_KILL_SWITCH=on — enrichment Groq call suppressed (deterministic fallback)')
    } catch {}
    return { text: '', cached: false, killed: true, model: routed }
  }
  const hash = enrichPromptHash(prompt)
  try {
    const hit = await getCachedEnrichResponse(routed, hash)
    if (hit !== null) return { text: hit, cached: true, killed: false, model: routed }
  } catch {}
  // Decide model override WITHOUT breaking admin config: only the synthetic
  // Groq fallback (no managed provider) is rewritten to 20b. Managed
  // providers keep serving with their configured model (options.model unset).
  let modelOverride: string | undefined
  try {
    if (!opts?.model) {
      const managed = await hasManagedProvider('enrichment')
      if (!managed) modelOverride = routed
    } else {
      modelOverride = opts.model
    }
  } catch {
    modelOverride = undefined
  }
  let text = ''
  try {
    // Global singleflight per prompt-hash: concurrent identical enrichments
    // (cron overlap, double-POST) share 1 Groq call instead of N.
    text = await memoizedSingleflight(enrichResponseKey(routed, hash), ENRICH_RESPONSE_TTL_MS, async () => {
      try {
        const cachedRace = await getCachedEnrichResponse(routed, hash)
        if (cachedRace !== null) return cachedRace
      } catch {}
      const out = await chatCompletion(
        'enrichment',
        [{ role: 'user', content: prompt }],
        {
          temperature: opts?.temperature ?? 0.1,
          max_tokens: opts?.max_tokens ?? 4000,
          ...(modelOverride ? { model: modelOverride } : {}),
        } as { temperature?: number; max_tokens?: number; model?: string },
      )
      return typeof out === 'string' ? out : ''
    })
  } catch (e) {
    // Groq failure (429 TPM, outage): propagate nothing cached; caller logs
    // and keeps deterministic behavior (stages converts to AiRateLimitError).
    throw e
  }
  if (text) {
    // Best-effort write (memoizedSingleflight already SET it on miss; this
    // covers the direct-hit path races). Never throws.
    await setCachedEnrichResponse(routed, hash, text)
    // `cached` is true only when WE served from cache above (hit !== null).
    // The singleflight path may still have shared a concurrent winner's Groq
    // call — report cached:false (a Groq call happened for someone).
    try {
      const hit = await getCachedEnrichResponse(routed, hash)
      void hit
    } catch {}
  }
  return { text, cached: false, killed: false, model: routed }
}

export interface EnrichBatchResult {
  enriched: number
  cached: number
  failed: number
}

/**
 * Process enrich IDs in ×10 windows with cache-aware gaps.
 * - `enrichFn` may return `{cached?: boolean}` (stages does) or void.
 * - The inter-row Groq gap (`delayMs`, default 12s TPM protection) applies
 *   ONLY after cache MISSES; cache HITs proceed immediately (the 20min
 *   sequential cron hold collapses to ~misses×gap).
 * - Never throws (per-row errors count as failed, batch continues).
 */
export async function processEnrichBatch(
  ids: string[],
  enrichFn: (id: string) => Promise<{ cached?: boolean } | void>,
  opts?: { batchSize?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<EnrichBatchResult> {
  const out: EnrichBatchResult = { enriched: 0, cached: 0, failed: 0 }
  try {
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : []
    if (list.length === 0) return out
    const rawBatch = Number(opts?.batchSize)
    const batchSize = Number.isFinite(rawBatch) && rawBatch > 0 ? Math.min(50, Math.floor(rawBatch)) : ENRICH_BATCH_SIZE
    const rawDelay = Number(opts?.delayMs)
    const delayMs = Number.isFinite(rawDelay) && rawDelay >= 0 ? Math.floor(rawDelay) : 12_000
    const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
    for (let w = 0; w < list.length; w += batchSize) {
      const window = list.slice(w, w + batchSize)
      for (let i = 0; i < window.length; i++) {
        const id = window[i]
        const isLast = w + i === list.length - 1
        let cached = false
        try {
          const res = await enrichFn(id)
          out.enriched++
          cached = !!((res as { cached?: boolean } | null | undefined) && (res as { cached?: boolean }).cached === true)
          if (cached) out.cached++
        } catch {
          out.failed++
        }
        // Gap only after real Groq work (miss/unknown) and never after the
        // final row. Cached rows + failures-after-throw skip the sleep.
        if (!isLast && !cached && delayMs > 0) {
          try {
            await sleep(delayMs)
          } catch {}
        }
      }
    }
  } catch {}
  return out
}

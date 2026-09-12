// opportunities/pipeline.ts — fetch → dedup → save → enrich stage helpers (SRP).
// WHY: orchestrator stages were inline in opportunityAgent.ts; extracted so
// each stage is independently testable with fakes (no network/DB).

import { isEnded } from './dates'
import { dedupInMemory } from './dedup'
import type { NormalizedOpportunity } from './types'

export interface PipelineResult {
  fetched: number
  kept: number
  items: NormalizedOpportunity[]
}

/** Stage 1 — fan out with bounded concurrency (p-limit 5, no new dep). */
export async function fanOut<T>(tasks: Array<() => Promise<T[]>>, concurrency = 5): Promise<T[]> {
  if (tasks.length === 0) return []
  const settled: PromiseSettledResult<T[]>[] = new Array(tasks.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const i = next++
      if (i >= tasks.length) return
      try {
        settled[i] = { status: 'fulfilled', value: await tasks[i]() } as PromiseFulfilledResult<T[]>
      } catch (e) {
        settled[i] = { status: 'rejected', reason: e } as PromiseRejectedResult
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()))
  return settled
    .filter((r): r is PromiseFulfilledResult<T[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)
}

/** Stage 2 — filter ended + in-memory dedup (pure, no DB). */
export function filterActiveUnique(opps: NormalizedOpportunity[]): NormalizedOpportunity[] {
  return dedupInMemory(opps.filter((o) => !isEnded(o.deadline, o.title)))
}

/** Stage 3 — chunk an array for bounded DB writes (notify parity: 500/chunk). */
// Canonical impl lives in services/notify/chunked.ts (SSOT). Re-exported here
// so existing `from './pipeline'` importers keep working without churn.
export { chunk } from '../notify/chunked'

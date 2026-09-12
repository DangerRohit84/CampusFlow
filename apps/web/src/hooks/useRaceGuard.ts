import { useCallback, useEffect, useRef } from 'react'

/**
 * Race guard — abort + sequence in one place (no out-of-order stale).
 *
 * WHY: manual `useState` pages fetch via `useEffect`. Rapid filter/page/tab
 * switches fire overlapping requests; without abort + sequencing the SLOWER
 * (older) response can resolve LAST and overwrite the newer list — the page
 * then shows a stale slice until refresh.
 *
 * Pattern (matches AssignmentHubPage, the working reference):
 * - `newRequest()` aborts the previous controller, bumps the seq, and returns
 *   `{ signal, seq }` for this request.
 * - Callers skip `setState` when `seq !== currentSeq()` or `signal.aborted`,
 *   and ignore `CanceledError` / `ERR_CANCELED`.
 * - Unmount aborts automatically (no setState-after-unmount).
 *
 * For React Query pages, prefer the built-in `queryFn: ({ signal })` param
 * (TanStack aborts stale keys automatically) — this hook is for manual pages.
 */
export function useRaceGuard() {
  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    return () => {
      try {
        abortRef.current?.abort()
      } catch {}
    }
  }, [])

  const newRequest = useCallback((): { signal: AbortSignal; seq: number } => {
    try {
      abortRef.current?.abort()
    } catch {}
    const controller = new AbortController()
    abortRef.current = controller
    seqRef.current += 1
    return { signal: controller.signal, seq: seqRef.current }
  }, [])

  const isCurrent = useCallback((seq: number): boolean => {
    return seq === seqRef.current && !(abortRef.current?.signal.aborted ?? false)
  }, [])

  const abort = useCallback(() => {
    try {
      abortRef.current?.abort()
    } catch {}
  }, [])

  return { newRequest, isCurrent, abort, abortRef, seqRef }
}

/** True for axios cancellations + DOM aborts — callers must swallow these. */
export function isAbortError(e: any, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  const name = e?.name || e?.code
  return (
    name === 'CanceledError' ||
    name === 'AbortError' ||
    e?.code === 'ERR_CANCELED' ||
    e?.message === 'canceled'
  )
}

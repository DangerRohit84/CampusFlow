/**
 * CampusFlow — lightweight RUM (Vercel/Shopify pattern, no extra dep).
 * WHY: re-audit found no p50/p95/99, no LCP/CLS/INP signal. This uses native
 * PerformanceObserver + navigation timing (no `web-vitals` dep, ~0KB) and
 * batches to console.debug + optional beacon. Add your analytics endpoint via
 * `VITE_RUM_ENDPOINT` to ship to prod; otherwise it stays local-only.
 */

type Metric = { name: string; value: number; rating: 'good' | 'needs-improvement' | 'poor'; at: number }

const RUM_ENDPOINT = (import.meta as any)?.env?.VITE_RUM_ENDPOINT as string | undefined

function ratingFor(name: string, value: number): Metric['rating'] {
  // Thresholds aligned with web.dev (LCP 2.5s, CLS 0.1, INP 200ms, FCP 1.8s, TTFB 800ms)
  if (name === 'LCP') return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor'
  if (name === 'CLS') return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor'
  if (name === 'INP') return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor'
  if (name === 'FCP') return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor'
  if (name === 'TTFB') return value <= 800 ? 'good' : value <= 1800 ? 'needs-improvement' : 'poor'
  return 'good'
}

const queue: Metric[] = []
let flushTimer: number | null = null

function enqueue(m: Metric) {
  queue.push(m)
  try {
    // WHY: dev-only console (no prod noise/PII). Prod ships via VITE_RUM_ENDPOINT beacon when consented.
    if ((import.meta as any)?.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug(`[rum] ${m.name}=${Math.round(m.value * 100) / 100} (${m.rating})`)
    }
  } catch {}
  // WHY: RUM beacon is prod-only + consent-gated. Dev stays console-only; no endpoint = no network.
  const isProd = (import.meta as any)?.env?.PROD
  const consented = (() => {
    try {
      try { const v2raw = localStorage.getItem('campusflow-cookie-consent-v2'); if (v2raw) { const rr = JSON.parse(v2raw); if (rr && rr.rum === true) return true } } catch {} return localStorage.getItem('campusflow-cookie-consent') === 'accepted'
    } catch {
      return false
    }
  })()
  if (!isProd || !consented || !RUM_ENDPOINT) {
    // Drain queue silently in dev / without consent / without endpoint so memory doesn't grow.
    if (flushTimer == null) {
      flushTimer = window.setTimeout(() => {
        flushTimer = null
        queue.splice(0, queue.length)
      }, 5000)
    }
    return
  }
  if (flushTimer != null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    const batch = queue.splice(0, queue.length)
    if (!batch.length || !RUM_ENDPOINT) return
    try {
      const body = JSON.stringify({ metrics: batch, url: location.href, at: Date.now() })
      if (navigator.sendBeacon) navigator.sendBeacon(RUM_ENDPOINT, body)
      else void fetch(RUM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    } catch {}
  }, 5000)
}

export function initWebVitals() {
  try {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return
    if ((window as any).__campusflow_rum_init) return
    ;(window as any).__campusflow_rum_init = true
    // LCP — hero paint (preload hero only, lazy rest keeps this low)
    try {
      const lcp = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const last = entries[entries.length - 1] as any
        if (last) enqueue({ name: 'LCP', value: last.startTime, rating: ratingFor('LCP', last.startTime), at: Date.now() })
      })
      lcp.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch {}
    // CLS — layout shift (width/height on images prevents this)
    try {
      let cls = 0
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (!(e as any).hadRecentInput) cls += (e as any).value || 0
        }
        enqueue({ name: 'CLS', value: cls, rating: ratingFor('CLS', cls), at: Date.now() })
      })
      obs.observe({ type: 'layout-shift', buffered: true })
    } catch {}
    // INP — interaction latency (virtualized lists + keepPreviousData keep this low)
    try {
      const inp = new PerformanceObserver((list) => {
        const entries = list.getEntries() as any[]
        const worst = entries.reduce((a, b) => ((b.duration || 0) > (a.duration || 0) ? b : a), entries[0])
        if (worst) enqueue({ name: 'INP', value: worst.duration, rating: ratingFor('INP', worst.duration), at: Date.now() })
      })
      inp.observe({ type: 'event', buffered: true, durationThreshold: 40 } as any)
    } catch {}
    // FCP + TTFB from navigation timing
    try {
      const nav = performance.getEntriesByType('navigation')[0] as any
      if (nav) {
        enqueue({ name: 'TTFB', value: nav.responseStart, rating: ratingFor('TTFB', nav.responseStart), at: Date.now() })
      }
      const fcp = new PerformanceObserver((list) => {
        const e = list.getEntries()[0] as any
        if (e) enqueue({ name: 'FCP', value: e.startTime, rating: ratingFor('FCP', e.startTime), at: Date.now() })
      })
      fcp.observe({ type: 'paint', buffered: true })
    } catch {}
  } catch {}
}


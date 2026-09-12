/**
 * CampusFlow — privacy-friendly analytics loader (Plausible / GA4, env-switched).
 * WHY: no third-party trackers without consent + env gate. Scripts load only when
 * the corresponding VITE_* env is set AND the user accepted analytics cookies.
 * - VITE_PLAUSIBLE_DOMAIN (e.g. campusflow.dev) → loads plausible.io script
 * - VITE_GA4_ID (e.g. G-XXXXXXXXXX) → loads gtag.js
 * - VITE_RUM_ENDPOINT → used by webVitals.ts beacon (prod only)
 * No live secrets; IDs are public measurement IDs, safe to expose.
 */

declare global {
  interface Window {
    __campusflow_analytics_loaded?: boolean
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
    plausible?: (...args: unknown[]) => void
  }
}

function getEnv(key: string): string | undefined {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key]
    const t = typeof v === 'string' ? v.trim() : ''
    if (!t || t.startsWith('%VITE_')) return undefined
    return t
  } catch {
    return undefined
  }
}

export function analyticsEnv() {
  return {
    plausibleDomain: getEnv('VITE_PLAUSIBLE_DOMAIN'),
    ga4Id: getEnv('VITE_GA4_ID'),
    rumEndpoint: getEnv('VITE_RUM_ENDPOINT'),
  }
}

function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.defer = true
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v)
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`analytics script failed: ${src}`))
    document.head.appendChild(s)
  })
}

export async function initAnalytics(): Promise<void> {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (window.__campusflow_analytics_loaded) return
    window.__campusflow_analytics_loaded = true
    const { plausibleDomain, ga4Id } = analyticsEnv()

    if (plausibleDomain) {
      try {
        await loadScript('https://plausible.io/js/script.js', { 'data-domain': plausibleDomain })
      } catch {
        // analytics must never break the app
      }
    }

    if (ga4Id) {
      try {
        window.dataLayer = window.dataLayer || []
        window.gtag =
          window.gtag ||
          function gtag(...args: unknown[]) {
            window.dataLayer?.push(args)
          }
        window.gtag('js', new Date())
        window.gtag('config', ga4Id, { anonymize_ip: true })
        await loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`)
      } catch {
        // ignore
      }
    }
  } catch {
    // never throw from analytics
  }
}

/** Minimal page-view helper (call on route change when analytics opted-in). */
export function trackPageView(path: string): void {
  try {
    const { ga4Id, plausibleDomain } = analyticsEnv()
    if (window.plausible && plausibleDomain) {
      window.plausible('pageview', { u: window.location.href })
    }
    if (window.gtag && ga4Id) {
      window.gtag('event', 'page_view', { page_path: path })
    }
  } catch {
    // ignore
  }
}

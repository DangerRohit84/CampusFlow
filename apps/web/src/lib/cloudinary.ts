/**
 * lib/cloudinary.ts — Cloudinary delivery-URL hygiene (P0-C images).
 * WHY: stored `secure_url`s are canonical (no transforms). At render time every
 * delivery URL must carry `f_auto` (AVIF/WebP negotiation per browser) +
 * `q_auto` (~40-60% bytes saved, plan-cost-speed-stability P1-7 §2.10), with
 * responsive `w_*` breakpoints + `c_limit` (never upscale) for srcset/sizes.
 * Upload-time eager is deliberately NOT used (bills a transform per upload).
 *
 * All helpers are pure + FAIL-OPEN: non-Cloudinary input (local /uploads,
 * Unsplash `auto=format`, data/blob URLs, garbage) is returned UNCHANGED and
 * nothing ever throws — images must never break pages.
 * Mirrors `packages/backend/src/config/storage.ts` delivery helpers (separate
 * deployable, so the ~40-line logic is duplicated by design — documented here).
 */

const DELIVERY_UPLOAD_MARKER = '/upload/'

export function isCloudinaryDeliveryUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  if (!/^https?:\/\//i.test(value)) return false
  try {
    const url = new URL(value)
    if (!/\.?res\.cloudinary\.com$/i.test(url.hostname)) return false
    return url.pathname.indexOf(DELIVERY_UPLOAD_MARKER) !== -1
  } catch {
    return false
  }
}

export interface DeliveryTransformOptions {
  /** Render width in px. Emitted as `w_{n},c_limit` (c_limit = never upscale). */
  width?: number
  /** Delivery quality. Default 'auto' (q_auto). */
  quality?: 'auto' | 'eco' | number
  /** Delivery format. Default 'auto' (f_auto = AVIF/WebP negotiation). */
  format?: 'auto' | 'webp' | 'jpg' | 'png'
}

function buildDeliveryTransform(opts: DeliveryTransformOptions = {}): string {
  const format = opts.format ?? 'auto'
  const parts = [`f_${format}`]
  const quality = opts.quality ?? 'auto'
  // NOTE: Cloudinary eco mode is `q_auto:eco`, not `q_eco`.
  parts.push(typeof quality === 'number' ? `q_${quality}` : quality === 'eco' ? 'q_auto:eco' : `q_${quality}`)
  if (typeof opts.width === 'number' && Number.isFinite(opts.width) && opts.width > 0) {
    parts.push(`w_${Math.round(opts.width)}`, 'c_limit')
  }
  return parts.join(',')
}

/**
 * Inject `f_auto,q_auto` (+ optional width) into a Cloudinary delivery URL.
 * Preserves version (`v123`) + existing transform chains (prepends, dedupes);
 * idempotent — a second pass returns the input unchanged.
 */
export function optimizeCloudinaryUrl(url: string, opts: DeliveryTransformOptions = {}): string {
  try {
    if (!isCloudinaryDeliveryUrl(url)) return url
    const parsed = new URL(url)
    const markerIndex = parsed.pathname.indexOf(DELIVERY_UPLOAD_MARKER)
    if (markerIndex === -1) return url
    const head = parsed.pathname.substring(0, markerIndex + DELIVERY_UPLOAD_MARKER.length)
    const tail = parsed.pathname.substring(markerIndex + DELIVERY_UPLOAD_MARKER.length)
    if (!tail) return url
    const transform = buildDeliveryTransform(opts)
    const segments = tail.split('/')
    let version: string | null = null
    let i = 0
    // Optional asset-version segment (v{digits}) preserved AFTER the transform
    // chain (Cloudinary canonical order).
    if (segments.length > 0 && /^v\d+$/.test(segments[0])) {
      version = segments[0]
      i = 1
    }
    const candidate = segments[i] ?? ''
    const isTransformChain =
      candidate.length > 0 &&
      !candidate.includes('.') &&
      /^[a-zA-Z][a-zA-Z0-9_:.,-]*$/.test(candidate) &&
      /[_:]/.test(candidate)
    let merged: string
    if (isTransformChain) {
      const existing = candidate
      if (existing === transform || existing.startsWith(`${transform},`)) {
        return url // Already optimized — never stack duplicates.
      }
      const hasFormat = /(^|,)f_[a-z0-9]+/.test(existing)
      const hasQuality = /(^|,)q_/.test(existing)
      merged = hasFormat && hasQuality ? existing : `${transform},${existing}`
      i += 1
    } else {
      merged = transform
    }
    parsed.pathname = head + [merged, ...(version ? [version] : []), ...segments.slice(i)].join('/')
    return parsed.toString()
  } catch {
    return url
  }
}

/** Responsive width breakpoints (px) for srcset bundles. */
export const CLOUDINARY_RESPONSIVE_WIDTHS = [320, 480, 640, 800, 1200] as const

/** Width-breakpoint srcset with f_auto/q_auto per candidate. Fail-open passthrough. */
export function cloudinarySrcSet(url: string, widths: readonly number[] = CLOUDINARY_RESPONSIVE_WIDTHS): string {
  try {
    if (!isCloudinaryDeliveryUrl(url)) return url
    const list = (widths ?? []).filter((w) => typeof w === 'number' && w > 0)
    if (list.length === 0) return url
    return list.map((w) => `${optimizeCloudinaryUrl(url, { width: w })} ${Math.round(w)}w`).join(', ')
  } catch {
    return url
  }
}

/** Tiny blurred placeholder (LQIP) for blur-up backgrounds. ~1KB over the wire. */
export function cloudinaryLqip(url: string): string {
  try {
    if (!isCloudinaryDeliveryUrl(url)) return url
    const parsed = new URL(url)
    const markerIndex = parsed.pathname.indexOf(DELIVERY_UPLOAD_MARKER)
    if (markerIndex === -1) return url
    const head = parsed.pathname.substring(0, markerIndex + DELIVERY_UPLOAD_MARKER.length)
    const tail = parsed.pathname.substring(markerIndex + DELIVERY_UPLOAD_MARKER.length)
    const segments = tail.split('/')
    const version = segments[0] && /^v\d+$/.test(segments[0]) ? segments[0] : null
    const rest = version ? segments.slice(1) : segments
    const pathWithoutTransform =
      rest.length > 0 && rest[0].length > 0 && !rest[0].includes('.') && /[_:]/.test(rest[0])
        ? rest.slice(1)
        : rest
    // Canonical order: transformation chain first, then version, then public id.
    parsed.pathname =
      head + ['f_auto,q_auto:eco,w_24,c_limit,e_blur:800', ...(version ? [version] : []), ...pathWithoutTransform].join('/')
    return parsed.toString()
  } catch {
    return url
  }
}

import fs from 'fs'
import path from 'path'
import { v2 as cloudinary } from 'cloudinary'
import { logger } from '../utils/logger'

export interface UploadOptions {
  folder?: string
  resourceType?: 'image' | 'video' | 'raw' | 'auto'
  fileName?: string
}

export interface UploadResult {
  url: string
  publicId?: string
}

const cloudName = process.env.CLOUDINARY_CLOUD_NAME
const apiKey = process.env.CLOUDINARY_API_KEY
const apiSecret = process.env.CLOUDINARY_API_SECRET

export const storageMode: 'cloudinary' | 'local' =
  cloudName && apiKey && apiSecret ? 'cloudinary' : 'local'

// Prod parity guard (popular-site parity): ephemeral disk on Render/Railway loses
// /uploads on every restart/redeploy. Fail fast in production instead of silently
// writing files that will vanish.
if (process.env.NODE_ENV === 'production' && storageMode !== 'cloudinary') {
  throw new Error(
    'CLOUDINARY_* env vars are required in production (storageMode must be cloudinary). ' +
      'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.'
  )
}

if (storageMode === 'cloudinary') {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  })
  logger.info('[Storage] Mode: cloudinary')
} else {
  logger.info('[Storage] Mode: local disk (set CLOUDINARY_* env vars for production persistence)')
}

const LOCAL_UPLOAD_ROOT = path.resolve(__dirname, '../../uploads')

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 100)
}

function sanitizePathSegment(segment: string): string {
  // Replace Windows-invalid characters :*?"<>| and control chars with '-'
  // Also handle trailing dots/spaces which Windows disallows, and limit length
  let sanitized = segment.replace(/[:*?"<>|]/g, '-').replace(/[\x00-\x1f\x7f]/g, '')
  sanitized = sanitized.replace(/^[. ]+/, '').replace(/[. ]+$/, '').trim()
  if (!sanitized || sanitized === '.' || sanitized === '..') sanitized = '_'
  return sanitized.substring(0, 100)
}

function sanitizeFolderPath(folder: string): string {
  return folder
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s.length > 0)
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join('/')
}

function generateLocalFilename(fileName?: string): string {
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
  return `${uniqueSuffix}-${sanitizeFilename(fileName || 'file')}`
}

function cloudinaryUploadOptions(options: UploadOptions) {
  return {
    folder: options.folder ? sanitizeFolderPath(options.folder) : undefined,
    resource_type: options.resourceType || 'auto',
    use_filename: true,
    unique_filename: true,
    filename_override: options.fileName ? sanitizeFilename(options.fileName) : undefined,
  }
}

function uploadBufferToCloudinary(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      cloudinaryUploadOptions(options),
      (error, result) => {
        if (error || !result) {
          reject(error || new Error('Cloudinary upload failed'))
          return
        }
        resolve({ url: result.secure_url, publicId: result.public_id })
      }
    )
    stream.end(buffer)
  })
}

async function uploadPathToCloudinary(filePath: string, options: UploadOptions): Promise<UploadResult> {
  const result = await cloudinary.uploader.upload(filePath, cloudinaryUploadOptions(options))
  return { url: result.secure_url, publicId: result.public_id }
}

function parseCloudinaryRef(value: string): { publicId: string; resourceType: 'image' | 'video' | 'raw' } | null {
  if (!/^https?:\/\//i.test(value)) {
    return value.includes('/') ? { publicId: value, resourceType: 'image' } : null
  }
  try {
    const url = new URL(value)
    const marker = '/upload/'
    const markerIndex = url.pathname.indexOf(marker)
    if (markerIndex === -1) return null
    const prefixSegments = url.pathname.substring(0, markerIndex).split('/').filter(Boolean)
    const lastSegment = prefixSegments[prefixSegments.length - 1]
    const resourceType: 'image' | 'video' | 'raw' =
      lastSegment === 'video' || lastSegment === 'raw' ? lastSegment : 'image'
    let publicId = url.pathname.substring(markerIndex + marker.length)
    publicId = publicId.replace(/^v\d+\//, '')
    if (resourceType !== 'raw') {
      const lastSlash = publicId.lastIndexOf('/')
      const lastDot = publicId.lastIndexOf('.')
      if (lastDot > lastSlash) publicId = publicId.substring(0, lastDot)
    }
    return { publicId: decodeURIComponent(publicId), resourceType }
  } catch {
    return null
  }
}

export async function uploadFile(input: Buffer | string, options: UploadOptions = {}): Promise<UploadResult> {
  if (storageMode === 'cloudinary') {
    if (typeof input === 'string') {
      return uploadPathToCloudinary(input, options)
    }
    return uploadBufferToCloudinary(input, options)
  }

  const relativeFolder = options.folder ? sanitizeFolderPath(options.folder) : ''
  const dir = path.resolve(path.join(LOCAL_UPLOAD_ROOT, relativeFolder))
  const relDir = path.relative(LOCAL_UPLOAD_ROOT, dir)
  if (relDir === '' || relDir.startsWith('..') || path.isAbsolute(relDir)) {
    throw new Error('Invalid upload folder')
  }
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const filename = generateLocalFilename(options.fileName)
  const filePath = path.join(dir, filename)

  if (typeof input === 'string') {
    fs.copyFileSync(input, filePath)
  } else {
    fs.writeFileSync(filePath, input)
  }

  const url = relativeFolder ? `/uploads/${relativeFolder}/${filename}` : `/uploads/${filename}`
  return { url }
}

export async function deleteFile(urlOrPublicId: string): Promise<void> {
  try {
    if (storageMode === 'cloudinary') {
      const parsed = parseCloudinaryRef(urlOrPublicId)
      if (!parsed) return
      await cloudinary.uploader.destroy(parsed.publicId, { resource_type: parsed.resourceType })
      return
    }

    let filePath: string | null = null
    if (urlOrPublicId.startsWith('/uploads/')) {
      filePath = path.resolve(path.join(LOCAL_UPLOAD_ROOT, urlOrPublicId.replace(/^\/uploads\//, '')))
    } else if (path.isAbsolute(urlOrPublicId)) {
      filePath = urlOrPublicId
    }
    if (filePath) {
      const relPath = path.relative(LOCAL_UPLOAD_ROOT, filePath)
      if (relPath !== '' && !relPath.startsWith('..') && !path.isAbsolute(relPath) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    }
  } catch (err) {
    logger.error({ err: err }, 'Storage deleteFile error:')
  }
}

// ---------------------------------------------------------------------------
// Delivery-URL hygiene (P0-C images, plan-cost-speed-stability P1-7).
// WHY delivery transforms, not upload-time eager: `f_auto` (AVIF/WebP
// negotiation per browser) + `q_auto` (~40-60% bytes saved) are delivery
// concerns; upload-time eager would bill a transformation per upload.
// Stored `secure_url`s stay canonical; callers optimize at render time.
// All helpers are pure + FAIL-OPEN: non-Cloudinary or unparsable input is
// returned unchanged and nothing ever throws (images must never break pages).
// ---------------------------------------------------------------------------

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

function buildDeliveryTransform(opts: DeliveryTransformOptions = {}, extra?: string): string {
  const format = opts.format ?? 'auto'
  const parts = [`f_${format}`]
  const quality = opts.quality ?? 'auto'
  // NOTE: Cloudinary eco mode is `q_auto:eco`, not `q_eco`.
  parts.push(typeof quality === 'number' ? `q_${quality}` : quality === 'eco' ? 'q_auto:eco' : `q_${quality}`)
  if (typeof opts.width === 'number' && Number.isFinite(opts.width) && opts.width > 0) {
    parts.push(`w_${Math.round(opts.width)}`, 'c_limit')
  }
  if (extra) parts.push(extra)
  return parts.join(',')
}

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
    // Optional asset-version segment (v{digits}) is preserved verbatim, AFTER
    // the transformation chain (Cloudinary canonical order).
    if (segments.length > 0 && /^v\d+$/.test(segments[0])) {
      version = segments[0]
      i = 1
    }
    // Optional single transformation-chain segment: comma-separated ops with
    // no file extension (public ids always carry the extension or are extensionless raw).
    const candidate = segments[i] ?? ''
    const isTransformChain =
      candidate.length > 0 && !candidate.includes('.') && /^[a-zA-Z][a-zA-Z0-9_:.,-]*$/.test(candidate) && /[_:]/.test(candidate)
    let merged: string
    if (isTransformChain) {
      const existing = candidate
      if (existing === transform || existing.startsWith(`${transform},`)) {
        return url // Already optimized — idempotent, never stack duplicates.
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
    const stripExisting = segments[0] && /^v\d+$/.test(segments[0]) ? [segments[0]] : []
    const rest = stripExisting.length > 0 ? segments.slice(1) : segments
    // Drop any existing transformation chain for the placeholder (keep public id path).
    const pathWithoutTransform =
      rest.length > 0 && rest[0].length > 0 && !rest[0].includes('.') && /[_:]/.test(rest[0])
        ? rest.slice(1)
        : rest
    // Canonical order: transformation chain first, then version, then public id.
    parsed.pathname = head + ['f_auto,q_auto:eco,w_24,c_limit,e_blur:800', ...stripExisting, ...pathWithoutTransform].join('/')
    return parsed.toString()
  } catch {
    return url
  }
}

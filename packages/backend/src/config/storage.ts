import fs from 'fs'
import path from 'path'
import { v2 as cloudinary } from 'cloudinary'

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

if (storageMode === 'cloudinary') {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  })
  console.log('[Storage] Mode: cloudinary')
} else {
  console.log('[Storage] Mode: local disk (set CLOUDINARY_* env vars for production persistence)')
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
    console.error('Storage deleteFile error:', err)
  }
}

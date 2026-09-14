/**
 * lib/__tests__/cloudinary.test.ts — P0-C image delivery hygiene.
 * Hermetic pure tests (no DOM, no network): every Cloudinary delivery URL
 * must carry f_auto (AVIF/WebP negotiation) + q_auto, responsive srcsets use
 * width breakpoints with c_limit (never upscale), and non-Cloudinary input
 * (local /uploads, Unsplash, garbage) passes through UNCHANGED — fail-open so
 * images never break pages. Mirrors packages/backend storage.ts delivery helpers.
 */
import { describe, it, expect } from 'vitest'
import {
  isCloudinaryDeliveryUrl,
  optimizeCloudinaryUrl,
  cloudinarySrcSet,
  cloudinaryLqip,
  CLOUDINARY_RESPONSIVE_WIDTHS,
} from '../cloudinary'

const CLOUD =
  'https://res.cloudinary.com/demo/image/upload/v1710000000/campus/room-abc.jpg'
const LOCAL = '/uploads/rooms/abc.jpg'
const UNSPLASH =
  'https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1200&q=80&auto=format&fit=crop'

describe('isCloudinaryDeliveryUrl', () => {
  it('detects_cloudinary_upload_urls', () => {
    expect(isCloudinaryDeliveryUrl(CLOUD)).toBe(true)
  })
  it('rejects_local_unsplash_empty_and_garbage', () => {
    expect(isCloudinaryDeliveryUrl(LOCAL)).toBe(false)
    expect(isCloudinaryDeliveryUrl(UNSPLASH)).toBe(false)
    expect(isCloudinaryDeliveryUrl('')).toBe(false)
    expect(isCloudinaryDeliveryUrl('not a url')).toBe(false)
  })
})

describe('optimizeCloudinaryUrl', () => {
  it('injects_f_auto_q_auto_before_version', () => {
    expect(optimizeCloudinaryUrl(CLOUD)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1710000000/campus/room-abc.jpg',
    )
  })
  it('adds_width_with_c_limit', () => {
    expect(optimizeCloudinaryUrl(CLOUD, { width: 800 })).toContain('w_800,c_limit')
  })
  it('is_idempotent_second_pass_unchanged', () => {
    const once = optimizeCloudinaryUrl(CLOUD)
    expect(optimizeCloudinaryUrl(once)).toBe(once)
  })
  it('fail_open_passthrough_for_local_and_unsplash', () => {
    expect(optimizeCloudinaryUrl(LOCAL)).toBe(LOCAL)
    expect(optimizeCloudinaryUrl(UNSPLASH)).toBe(UNSPLASH)
  })
  it('fail_open_never_throws', () => {
    expect(() => optimizeCloudinaryUrl(null as unknown as string)).not.toThrow()
    expect(optimizeCloudinaryUrl(undefined as unknown as string)).toBe(undefined as unknown as string)
  })
})

describe('cloudinarySrcSet', () => {
  it('uses_default_responsive_breakpoints', () => {
    expect([...CLOUDINARY_RESPONSIVE_WIDTHS]).toEqual([320, 480, 640, 800, 1200])
  })
  it('builds_width_descriptors_with_f_auto_q_auto', () => {
    const srcset = cloudinarySrcSet(CLOUD, [320, 800])
    expect(srcset).toContain('320w')
    expect(srcset).toContain('800w')
    expect(srcset).toContain('f_auto,q_auto,w_320,c_limit')
    expect(srcset).toContain('f_auto,q_auto,w_800,c_limit')
  })
  it('fail_open_passthrough_for_local', () => {
    expect(cloudinarySrcSet(LOCAL)).toBe(LOCAL)
  })
})

describe('cloudinaryLqip', () => {
  it('builds_tiny_blurred_placeholder', () => {
    const lqip = cloudinaryLqip(CLOUD)
    expect(lqip).toContain('w_24')
    expect(lqip).toContain('e_blur:800')
  })
  it('fail_open_passthrough_for_local', () => {
    expect(cloudinaryLqip(LOCAL)).toBe(LOCAL)
  })
})

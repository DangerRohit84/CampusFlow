/**
 * Storage delivery-URL hygiene (P0-C images).
 * Hermetic pure tests (no network, no DB, no secrets):
 * - optimizeCloudinaryUrl injects f_auto,q_auto (+ optional w_N,c_limit) after
 *   /upload/, preserves version + existing transforms, never duplicates, and
 *   FAILS OPEN (non-Cloudinary / unparsable input returned unchanged, never throws).
 * - cloudinarySrcSet builds width-breakpoint srcsets; LQIP helper stays tiny+blurred.
 * WHY f_auto,q_auto: Cloudinary negotiates AVIF/WebP per browser + auto quality
 * (~40-60% bytes saved per plan-cost-speed-stability P1-7); delivery transforms
 * are used instead of upload-time eager (eager costs transforms $$ per upload).
 */
import { describe, it, expect } from 'vitest'
import {
  optimizeCloudinaryUrl,
  cloudinarySrcSet,
  cloudinaryLqip,
  isCloudinaryDeliveryUrl,
} from '../src/config/storage'

const CLOUD =
  'https://res.cloudinary.com/demo/image/upload/v1710000000/campus/room-abc.jpg'
const CLOUD_NO_VERSION =
  'https://res.cloudinary.com/demo/image/upload/campus/room-abc.jpg'
const CLOUD_WITH_TRANSFORM =
  'https://res.cloudinary.com/demo/image/upload/c_scale,w_200/v1710000000/campus/room-abc.jpg'
const LOCAL = '/uploads/rooms/abc.jpg'
const UNSPLASH =
  'https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1200&q=80&auto=format&fit=crop'

describe('isCloudinaryDeliveryUrl', () => {
  it('detects_cloudinary_upload_urls', () => {
    expect(isCloudinaryDeliveryUrl(CLOUD)).toBe(true)
    expect(isCloudinaryDeliveryUrl(CLOUD_WITH_TRANSFORM)).toBe(true)
  })
  it('rejects_local_unsplash_and_garbage', () => {
    expect(isCloudinaryDeliveryUrl(LOCAL)).toBe(false)
    expect(isCloudinaryDeliveryUrl(UNSPLASH)).toBe(false)
    expect(isCloudinaryDeliveryUrl('')).toBe(false)
    expect(isCloudinaryDeliveryUrl('not a url')).toBe(false)
  })
})

describe('optimizeCloudinaryUrl', () => {
  it('injects_f_auto_q_auto_after_upload_preserving_version', () => {
    expect(optimizeCloudinaryUrl(CLOUD)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1710000000/campus/room-abc.jpg',
    )
  })
  it('handles_urls_without_version_segment', () => {
    expect(optimizeCloudinaryUrl(CLOUD_NO_VERSION)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/campus/room-abc.jpg',
    )
  })
  it('prepends_to_existing_transforms_without_duplicating', () => {
    expect(optimizeCloudinaryUrl(CLOUD_WITH_TRANSFORM)).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_scale,w_200/v1710000000/campus/room-abc.jpg',
    )
    // Idempotent: second pass must not duplicate f_auto/q_auto.
    const once = optimizeCloudinaryUrl(CLOUD)
    expect(optimizeCloudinaryUrl(once)).toBe(once)
  })
  it('adds_width_with_c_limit_never_upscale', () => {
    expect(optimizeCloudinaryUrl(CLOUD, { width: 800 })).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_800,c_limit/v1710000000/campus/room-abc.jpg',
    )
  })
  it('fail_open_returns_input_unchanged_for_non_cloudinary', () => {
    expect(optimizeCloudinaryUrl(LOCAL)).toBe(LOCAL)
    expect(optimizeCloudinaryUrl(UNSPLASH)).toBe(UNSPLASH)
    expect(optimizeCloudinaryUrl('')).toBe('')
  })
  it('fail_open_never_throws_on_garbage', () => {
    expect(() => optimizeCloudinaryUrl(null as unknown as string)).not.toThrow()
    expect(optimizeCloudinaryUrl(null as unknown as string)).toBe(null as unknown as string)
    expect(() => optimizeCloudinaryUrl('::::')).not.toThrow()
  })
})

describe('cloudinarySrcSet', () => {
  it('builds_width_breakpoint_srcset_with_f_auto_q_auto', () => {
    const srcset = cloudinarySrcSet(CLOUD, [320, 800])
    expect(srcset).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_320,c_limit/v1710000000/campus/room-abc.jpg 320w, ' +
        'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_800,c_limit/v1710000000/campus/room-abc.jpg 800w',
    )
  })
  it('fail_open_returns_input_for_non_cloudinary', () => {
    expect(cloudinarySrcSet(LOCAL, [320])).toBe(LOCAL)
  })
})

describe('cloudinaryLqip', () => {
  it('builds_tiny_blurred_placeholder', () => {
    const lqip = cloudinaryLqip(CLOUD)
    expect(lqip).toContain('w_24')
    expect(lqip).toContain('e_blur:800')
    expect(lqip).toContain('f_auto')
  })
  it('fail_open_returns_input_for_non_cloudinary', () => {
    expect(cloudinaryLqip(LOCAL)).toBe(LOCAL)
  })
})

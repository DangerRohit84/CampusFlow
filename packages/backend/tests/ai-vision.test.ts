/**
 * ai-vision — regression for the LIVE timetable-upload vision failure.
 *
 * Symptom: upload reached AI Manager vision (model replied ~196 chars) but
 * said "I don't see an image attached" → JSON parse failed → 0 periods.
 * Root cause: src/ai/client.ts provider branches handled image parts
 * inconsistently — callAnthropic replaced every image with the literal text
 * "[image]" (text-only request), callGoogle assumed data-URLs, and the
 * OpenAI-compatible path (OpenCode Serve) forwarded non-canonical part
 * types + unbounded multi-MB payloads.
 *
 * Contract under test: vision calls ALWAYS inline the image as a base64
 * data-URL (downscaled when huge) regardless of provider; http(s) URLs are
 * kept only as a publicly-reachable fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

vi.mock('../src/services/ai-manager', () => ({
  __esModule: true,
  getProvidersForFeature: vi.fn(),
}))

import { getProvidersForFeature } from '../src/services/ai-manager'
import {
  visionCompletion,
  normalizeVisionMessages,
  canonicalizeContentParts,
  maybeDownscaleDataUrl,
  toAnthropicMessages,
} from '../src/ai/client'

const mockedRouting = vi.mocked(getProvidersForFeature)

// OpenCode Serve-like routed provider (OpenAI-compatible /chat/completions).
function serveProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'serve-1',
    name: 'OpenCode Serve',
    baseUrl: 'http://serve.local:8081/v1',
    apiKey: 'test-serve-key',
    model: 'default',
    type: 'openai-compatible',
    headers: {},
    ...overrides,
  }
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer()
}

function stubFetchReturning(text: string) {
  const calls: Array<{ url: string; init: any }> = []
  const fn = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('visionCompletion via OpenAI-compatible provider (OpenCode Serve)', () => {
  it('sends the image part inline as a data-URL with bytes matching the upload', async () => {
    mockedRouting.mockResolvedValue([serveProvider()] as any)
    const png = await tinyPng()
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const { calls } = stubFetchReturning('[{"title":"Math"}]')

    const out = await visionCompletion('timetable', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract classes. Return ONLY JSON.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ])

    expect(out).toBe('[{"title":"Math"}]')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://serve.local:8081/v1/chat/completions')

    const body = JSON.parse(calls[0].init.body)
    expect(body.model).toBe('default')
    const content = body.messages[0].content
    expect(Array.isArray(content)).toBe(true)
    const img = content.find((p: any) => p.type === 'image_url')
    expect(img).toBeDefined()
    expect(typeof img.image_url.url).toBe('string')
    expect(img.image_url.url.startsWith('data:')).toBe(true)
    // Bytes on the wire must equal the uploaded bytes (small image: no resize).
    const sentBytes = Buffer.from(img.image_url.url.split(',')[1], 'base64')
    expect(sentBytes.equals(png)).toBe(true)
    // Auth header present.
    expect(calls[0].init.headers.Authorization).toBe('Bearer test-serve-key')
  })

  it('canonicalizes {type:image} parts so strict gateways do not drop them', async () => {
    mockedRouting.mockResolvedValue([serveProvider()] as any)
    const png = await tinyPng()
    const { calls } = stubFetchReturning('[]')

    await visionCompletion('timetable', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
          } as any,
        ],
      },
    ])

    const body = JSON.parse(calls[0].init.body)
    const types = body.messages[0].content.map((p: any) => p.type).sort()
    expect(types).toEqual(['image_url', 'text'])
    const img = body.messages[0].content.find((p: any) => p.type === 'image_url')
    expect(img.image_url.url).toBe(`data:image/png;base64,${png.toString('base64')}`)
  })

  it('forwards provider custom headers (same as testProvider)', async () => {
    mockedRouting.mockResolvedValue([serveProvider({ headers: { 'X-Custom-Auth': 'yes' } })] as any)
    const png = await tinyPng()
    const { calls } = stubFetchReturning('[]')

    await visionCompletion('timetable', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
        ],
      },
    ])

    expect(calls[0].init.headers['X-Custom-Auth']).toBe('yes')
  })

  it('keeps publicly-reachable http(s) URLs as a fallback', async () => {
    mockedRouting.mockResolvedValue([serveProvider()] as any)
    const { calls } = stubFetchReturning('[]')

    await visionCompletion('timetable', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          { type: 'image_url', image_url: { url: 'https://example.com/tt.png' } },
        ],
      },
    ])

    const body = JSON.parse(calls[0].init.body)
    const img = body.messages[0].content.find((p: any) => p.type === 'image_url')
    expect(img.image_url.url).toBe('https://example.com/tt.png')
  })
})

describe('toAnthropicMessages (image must never become "[image]" text)', () => {
  it('maps inline data-URL to a real base64 image block with matching bytes', async () => {
    const png = await tinyPng()
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const msgs = toAnthropicMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ])
    const blocks = (msgs[0] as any).content
    const img = blocks.find((b: any) => b.type === 'image')
    expect(img).toBeDefined()
    expect(img.source.type).toBe('base64')
    expect(img.source.media_type).toBe('image/png')
    expect(Buffer.from(img.source.data, 'base64').equals(png)).toBe(true)
    // No placeholder text anywhere.
    expect(JSON.stringify(blocks)).not.toContain('[image]')
  })

  it('maps http(s) URLs to url-source image blocks', () => {
    const msgs = toAnthropicMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          { type: 'image_url', image_url: { url: 'https://example.com/tt.png' } },
        ],
      },
    ])
    const blocks = (msgs[0] as any).content
    const img = blocks.find((b: any) => b.type === 'image')
    expect(img.source).toEqual({ type: 'url', url: 'https://example.com/tt.png' })
  })
})

describe('canonicalizeContentParts', () => {
  it('leaves text and image_url parts untouched, converts image+base64 source', () => {
    const out = canonicalizeContentParts([
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBB' } } as any,
    ]) as any[]
    expect(out[0]).toEqual({ type: 'text', text: 'hi' })
    expect(out[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } })
    expect(out[2]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } })
  })
})

describe('maybeDownscaleDataUrl', () => {
  it('leaves small images byte-identical', async () => {
    const png = await tinyPng()
    const url = `data:image/png;base64,${png.toString('base64')}`
    await expect(maybeDownscaleDataUrl(url)).resolves.toBe(url)
  })

  it('downscales huge photos to bounded JPEG bytes', async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer()
    const url = `data:image/png;base64,${big.toString('base64')}`
    const out = await maybeDownscaleDataUrl(url)
    expect(out.startsWith('data:image/jpeg;base64,')).toBe(true)
    const outBuf = Buffer.from(out.split(',')[1], 'base64')
    expect(outBuf.length).toBeLessThan(big.length)
    // JPEG magic bytes.
    expect(outBuf[0]).toBe(0xff)
    expect(outBuf[1]).toBe(0xd8)
    const meta = await sharp(outBuf).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1568)
  })

  it('passes non-data URLs through untouched', async () => {
    await expect(maybeDownscaleDataUrl('https://example.com/tt.png')).resolves.toBe(
      'https://example.com/tt.png',
    )
  })
})

describe('normalizeVisionMessages', () => {
  it('keeps prompt text and inlines image bytes for every part', async () => {
    const png = await tinyPng()
    const out = await normalizeVisionMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'prompt' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
        ],
      },
    ])
    const content = out[0].content as any[]
    expect(content[0]).toEqual({ type: 'text', text: 'prompt' })
    expect(content[1].type).toBe('image_url')
    expect(Buffer.from(content[1].image_url.url.split(',')[1], 'base64').equals(png)).toBe(true)
  })
})

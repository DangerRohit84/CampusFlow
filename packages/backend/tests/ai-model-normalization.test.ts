/**
 * ai-model-normalization — regression for the AI Manager mystery:
 * direct curl with `opencode/muse-spark-1.3-contributor-free` returned 200,
 * but the AI Manager test with the same model ID failed while `default`
 * worked (same provider entry, ngrok base URL, empty Custom Headers).
 *
 * Root causes fixed:
 * 1) Backend forwarded `provider.model` verbatim (copy-paste whitespace broke
 *    the adapter split → opencode 500) while `default` bypassed the string
 *    entirely via auto-detect. Now the model is trimmed before send.
 * 2) Backend sent no `ngrok-skip-browser-warning` (proven-working curl had
 *    it). Now sent by default; provider.headers still overrides.
 * 3) Adapter `resolve_model_ref` strips whitespace and resolves bare IDs to
 *    (default provider, given model) instead of silently dropping them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'

vi.mock('../src/services/ai-manager', () => ({
  __esModule: true,
  getProvidersForFeature: vi.fn(),
}))

import { getProvidersForFeature } from '../src/services/ai-manager'
import { chatCompletion } from '../src/ai/client'

const mockedRouting = vi.mocked(getProvidersForFeature)

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'serve-1',
    name: 'OpenCode Serve',
    baseUrl: 'https://basis-earthling-smock.ngrok-free.dev/v1',
    apiKey: 'test-key',
    model: 'opencode/muse-spark-1.3-contributor-free',
    type: 'openai-compatible',
    headers: {},
    ...overrides,
  }
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

describe('explicit model IDs behave like default (trim + bypass header)', () => {
  it('trims whitespace around the model before send', async () => {
    mockedRouting.mockResolvedValue([provider({ model: '  opencode/muse-spark-1.3-contributor-free  ' })] as any)
    const { calls } = stubFetchReturning('ok')
    await chatCompletion('timetable', [{ role: 'user', content: 'hi' }])
    const body = JSON.parse(calls[0].init.body)
    expect(body.model).toBe('opencode/muse-spark-1.3-contributor-free')
  })

  it('sends ngrok-skip-browser-warning by default (proven curl parity)', async () => {
    mockedRouting.mockResolvedValue([provider()] as any)
    const { calls } = stubFetchReturning('ok')
    await chatCompletion('timetable', [{ role: 'user', content: 'hi' }])
    expect(calls[0].init.headers['ngrok-skip-browser-warning']).toBe('true')
  })

  it('provider custom headers still override the bypass default', async () => {
    mockedRouting.mockResolvedValue([provider({ headers: { 'ngrok-skip-browser-warning': 'false' } })] as any)
    const { calls } = stubFetchReturning('ok')
    await chatCompletion('timetable', [{ role: 'user', content: 'hi' }])
    expect(calls[0].init.headers['ngrok-skip-browser-warning']).toBe('false')
  })

  it('trims trailing slashes + whitespace on baseUrl', async () => {
    mockedRouting.mockResolvedValue([provider({ baseUrl: '  https://basis-earthling-smock.ngrok-free.dev/v1///  ' })] as any)
    const { calls } = stubFetchReturning('ok')
    await chatCompletion('timetable', [{ role: 'user', content: 'hi' }])
    expect(calls[0].url).toBe('https://basis-earthling-smock.ngrok-free.dev/v1/chat/completions')
  })
})

describe('testProvider path carries the same normalization (static contract)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/ai-manager.ts'), 'utf8')
  it('trims model + baseUrl and sends the bypass header', () => {
    expect(src).toContain("String(provider.model ?? '').trim()")
    expect(src).toContain("String(provider.baseUrl ?? '').trim()")
    expect(src).toContain("'ngrok-skip-browser-warning': 'true'")
  })
})

// pages/ChatPage focus guard — TDD RED.
// WHY: sending a message blurred the input (disabled={isTyping} drops focus;
// no ref + no focus() restore), forcing an extra click before the next ask.
// Contract: input stays enabled during request, keeps ref, restores focus
// after send + on done (finally) with preventScroll (no layout shift /
// mobile keyboard jump), placeholder preserved, send + Enter still gated.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { focusChatInput } from '../chatFocus'

function readChatPage(): string {
  return readFileSync(join(process.cwd(), 'src/pages/ChatPage.tsx'), 'utf8')
}

describe('focusChatInput helper (pure, no DOM)', () => {
  it('handleSend_stateUnderTest_expectedBehavior: focuses element with preventScroll', () => {
    let gotOpts: any = null
    const el = { focus: (o?: any) => { gotOpts = o } }
    expect(focusChatInput(el)).toBe(true)
    expect(gotOpts).toEqual({ preventScroll: true })
  })

  it('null element returns false (no throw)', () => {
    expect(focusChatInput(null)).toBe(false)
    expect(focusChatInput(undefined)).toBe(false)
  })

  it('focus throwing still resolves false (fail-safe, no crash)', () => {
    const el = { focus: () => { throw new Error('boom') } }
    expect(focusChatInput(el)).toBe(false)
  })

  it('legacy focus() without options still works (fallback call)', () => {
    let calls = 0
    const el = {
      focus: (...a: any[]) => {
        calls++
        if (a.length > 0) throw new TypeError('unsupported opts')
      },
    }
    // Must retry without args rather than fail.
    expect(focusChatInput(el)).toBe(true)
    expect(calls).toBe(2)
  })
})

describe('ChatPage input focus contract (source guard)', () => {
  it('input keeps a ref (no anonymous uncontrolled input)', () => {
    const src = readChatPage()
    expect(src).toMatch(/useRef<HTMLInputElement>/)
    expect(src).toMatch(/ref=\{inputRef\}/)
  })

  it('input stays enabled during request (disabled would blur + drop keyboard)', () => {
    const src = readChatPage()
    // Input must NOT be disabled by isTyping; send button stays gated.
    expect(src).not.toMatch(/<input[^>]*disabled=\{isTyping\}/)
    expect(src).toMatch(/placeholder="Ask me anything about campus life\.\.\."/)
  })

  it('send button + Enter handling still gated (no double-send)', () => {
    const src = readChatPage()
    expect(src).toMatch(/disabled=\{!input\.trim\(\) \|\| isTyping\}/)
    expect(src).toMatch(/onSubmit=/)
  })

  it('refocuses after send + on done with preventScroll (no extra click)', () => {
    const src = readChatPage()
    expect(src).toMatch(/focusChatInput\(inputRef\.current\)/)
    expect(src).toMatch(/preventScroll/)
    // At least two restore points: right after send + in finally/onDone.
    const hits = src.match(/focusChatInput\(inputRef\.current\)/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })
})

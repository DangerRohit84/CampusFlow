import { describe, it, expect } from 'vitest'
import { diffWords, countDiffChanges, hasDiffChanges, tokenizeWords } from '../wordDiff'

describe('wordDiff', () => {
  it('tokenizes on whitespace, drops empties', () => {
    expect(tokenizeWords('  hello   world\nnew\tline ')).toEqual(['hello', 'world', 'new', 'line'])
    expect(tokenizeWords('')).toEqual([])
  })

  it('returns empty for two empty strings', () => {
    expect(diffWords('', '')).toEqual([])
  })

  it('marks fully-added when before is empty', () => {
    expect(diffWords('', 'hello world')).toEqual([{ type: 'add', text: 'hello world' }])
  })

  it('marks fully-deleted when after is empty', () => {
    expect(diffWords('hello world', '')).toEqual([{ type: 'del', text: 'hello world' }])
  })

  it('returns single same run for identical text', () => {
    const tokens = diffWords('Built API with Node', 'Built API with Node')
    expect(tokens).toEqual([{ type: 'same', text: 'Built API with Node' }])
    expect(hasDiffChanges(tokens)).toBe(false)
  })

  it('diffs a single-word swap with surrounding same runs', () => {
    const tokens = diffWords('Built fast API', 'Built scalable API')
    expect(tokens).toEqual([
      { type: 'same', text: 'Built' },
      { type: 'del', text: 'fast' },
      { type: 'add', text: 'scalable' },
      { type: 'same', text: 'API' },
    ])
    expect(hasDiffChanges(tokens)).toBe(true)
    expect(countDiffChanges(tokens)).toEqual({ added: 1, removed: 1 })
  })

  it('merges consecutive same-type runs', () => {
    const tokens = diffWords('a b c', 'a x y c')
    // b -> x y swap: del(b), add(x y), same(a), same(c)
    expect(tokens).toContainEqual({ type: 'add', text: 'x y' })
    const adds = tokens.filter((t) => t.type === 'add')
    expect(adds).toHaveLength(1)
  })

  it('handles appended quantified tail (tailor use-case)', () => {
    const before = 'Built dashboard with React'
    const after = 'Built dashboard with React reducing load time by 30%'
    const tokens = diffWords(before, after)
    expect(tokens[0]).toEqual({ type: 'same', text: 'Built dashboard with React' })
    expect(tokens[tokens.length - 1].type).toBe('add')
    expect(countDiffChanges(tokens).added).toBe(5)
  })
})

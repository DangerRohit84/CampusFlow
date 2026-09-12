import { describe, it, expect } from 'vitest'
import { reposToProjects, mergeProjects } from '../githubImport'

describe('githubImport', () => {
  it('maps repos to project drafts (tech = language + topics, capped 6)', () => {
    const out = reposToProjects([
      { name: 'shop', description: 'E-com demo', language: 'TypeScript', stars: 12, forks: 2, url: 'https://github.com/u/shop', homepage: '', updatedAt: '2026-08-01T00:00:00Z', topics: ['react', 'node', 'a', 'b', 'c', 'd', 'e'] },
    ], 1000)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('shop')
    expect(out[0].link).toBe('https://github.com/u/shop')
    expect(out[0].tech.length).toBeLessThanOrEqual(6)
    expect(out[0].tech[0]).toBe('TypeScript')
    expect(out[0].description).toContain('★ 12 stars')
    expect(out[0].date).toBe('2026-08-01')
  })

  it('skips nameless repos and falls back to homepage link', () => {
    const out = reposToProjects([
      { name: '  ', description: '', language: '', stars: 0, forks: 0, url: '', homepage: '', updatedAt: '', topics: [] },
      { name: 'cli', description: '', language: '', stars: 0, forks: 0, url: '', homepage: 'https://cli.dev', updatedAt: '', topics: [] },
    ], 7)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('cli')
    expect(out[0].link).toBe('https://cli.dev')
  })

  it('mergeProjects dedupes case-insensitive titles and caps at 12', () => {
    const existing = [{ id: '1', title: 'Shop', description: '', tech: [], link: '', date: '' }]
    const merged = mergeProjects(existing as any, [
      { id: 'x', title: 'shop', description: '', tech: [], link: '', date: '' },
      { id: 'y', title: 'API', description: '', tech: [], link: '', date: '' },
    ] as any)
    expect(merged.map((p) => p.title)).toEqual(['Shop', 'API'])
    const many = mergeProjects([], Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `P${i}`, description: '', tech: [], link: '', date: '' })) as any)
    expect(many).toHaveLength(12)
  })
})

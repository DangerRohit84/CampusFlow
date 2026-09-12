// lib/resume/githubImport.ts — map public GitHub repos into resume projects.
// Pure, tested. Backend (GET /api/resume/github-repos/:username) does the
// fetching via api.github.com (no token); this module only transforms + merges
// so it is unit-testable without network.

import type { ResumeProject } from '../../types/resume'

export type GithubRepoBrief = {
  name: string
  description: string
  language: string
  stars: number
  forks: number
  url: string
  homepage: string
  updatedAt: string
  topics: string[]
}

/** Map repos → ResumeProject drafts. Newest-first input is preserved. */
export function reposToProjects(repos: GithubRepoBrief[], now: number = Date.now()): ResumeProject[] {
  return (repos || [])
    .filter((r) => r && String(r.name || '').trim())
    .map((r, i) => {
      const tech: string[] = []
      if (String(r.language || '').trim()) tech.push(String(r.language).trim())
      for (const t of r.topics || []) {
        const s = String(t || '').trim()
        if (s && !tech.map((x) => x.toLowerCase()).includes(s.toLowerCase())) tech.push(s)
        if (tech.length >= 6) break
      }
      const bits: string[] = []
      if (String(r.description || '').trim()) bits.push(String(r.description).trim())
      else bits.push('Open-source project.')
      if (Number(r.stars) > 0) bits.push(`★ ${r.stars} stars`)
      const date = String(r.updatedAt || '').slice(0, 10)
      return {
        id: `gh-${now.toString(36)}-${i}`,
        title: String(r.name).trim().slice(0, 80),
        description: bits.join(' ').slice(0, 500),
        tech,
        link: String(r.url || r.homepage || '').slice(0, 300),
        date,
      }
    })
}

/**
 * Merge incoming projects into existing, skipping case-insensitive title
 * duplicates. Caps the combined list at 12 (resume one-page discipline).
 */
export function mergeProjects(existing: ResumeProject[], incoming: ResumeProject[], cap = 12): ResumeProject[] {
  const seen = new Set((existing || []).map((p) => String(p.title || '').trim().toLowerCase()).filter(Boolean))
  const merged = [...(existing || [])]
  for (const p of incoming || []) {
    const key = String(p.title || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(p)
    if (merged.length >= cap) break
  }
  return merged
}

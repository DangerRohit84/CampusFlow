// lib/resume/metricCoach.ts — flags bullets lacking quantified impact + grounded rewrites.
// Pure, tested. Rule: a bullet "has metrics" iff it contains a digit (%, $, ₹,
// x, dates also count — deliberately lenient to avoid nagging). Suggestions never
// invent numbers: they keep the original text and append a bracketed placeholder
// the user must fill in (no hallucination).

import type { ResumeData } from '../../types/resume'

export type MetricFlag = {
  id: string
  section: 'experience' | 'projects'
  parentId: string
  parentTitle: string
  index: number
  text: string
  reason: string
  suggestion: string
}

const STRONG_VERBS = ['Built', 'Developed', 'Implemented', 'Optimized', 'Designed', 'Automated', 'Led', 'Improved', 'Shipped', 'Reduced']

/** Lenient metric check — any digit counts (covers %, $, ₹, xN, dates). */
export function hasMetric(text: string): boolean {
  return /\d/.test(String(text || ''))
}

function ensureVerb(text: string, fallbackIdx: number): string {
  const t = String(text || '').trim()
  if (!t) return 'Contributed to team deliverables'
  if (/^(Built|Developed|Implemented|Designed|Optimized|Led|Managed|Created|Automated|Improved|Increased|Reduced|Shipped|Delivered|Migrated|Refactored)\b/i.test(t)) {
    return t.charAt(0).toUpperCase() + t.slice(1)
  }
  const verb = STRONG_VERBS[fallbackIdx % STRONG_VERBS.length]
  return `${verb} ${t.charAt(0).toLowerCase() + t.slice(1)}`
}

/**
 * Grounded rewrite: keeps the user's fact, ensures action verb + period, and
 * appends a [bracketed metric placeholder] when no number is present — the user
 * fills the real number, so we never hallucinate impact.
 */
export function quantifyRewrite(bullet: string, fallbackIdx = 0): string {
  let t = ensureVerb(bullet, fallbackIdx).trim().replace(/\s+/g, ' ')
  if (!/[.]$/.test(t)) t += '.'
  if (!hasMetric(t)) {
    t += ' [Add metric: e.g., improved {metric} by X% over {period}].'
  }
  return t
}

/** Scan experience bullets + project descriptions for missing quantification. */
export function analyzeResume(data: ResumeData): MetricFlag[] {
  const flags: MetricFlag[] = []
  for (const exp of data?.experience || []) {
    const title = [exp.role, exp.company].filter(Boolean).join(' @ ') || 'Experience'
    ;(exp.bullets || []).forEach((b, idx) => {
      const text = String(b || '').trim()
      if (!text || text.length < 10) {
        flags.push({
          id: `experience:${exp.id}:${idx}`,
          section: 'experience',
          parentId: exp.id,
          parentTitle: title,
          index: idx,
          text,
          reason: 'Bullet is empty or too short — add a STAR-style achievement.',
          suggestion: quantifyRewrite(text || 'Contributed to team deliverables and shipped features', idx),
        })
      } else if (!hasMetric(text)) {
        flags.push({
          id: `experience:${exp.id}:${idx}`,
          section: 'experience',
          parentId: exp.id,
          parentTitle: title,
          index: idx,
          text,
          reason: 'No number — recruiters skim for quantified impact.',
          suggestion: quantifyRewrite(text, idx),
        })
      }
    })
  }
  for (const proj of data?.projects || []) {
    const text = String(proj.description || '').trim()
    if (!text) {
      flags.push({
        id: `projects:${proj.id}:desc`,
        section: 'projects',
        parentId: proj.id,
        parentTitle: proj.title || 'Untitled project',
        index: -1,
        text,
        reason: 'Project has no description — add 1-2 lines with stack + outcome.',
        suggestion: `${String(proj.title || 'Project').trim()} — ${(proj.tech || []).slice(0, 4).join(', ')} [Add metric: e.g., serves X users / cut latency by Y%].`,
      })
    } else if (!hasMetric(text)) {
      flags.push({
        id: `projects:${proj.id}:desc`,
        section: 'projects',
        parentId: proj.id,
        parentTitle: proj.title || 'Untitled project',
        index: -1,
        text,
        reason: 'No number — add users, latency, stars, or throughput.',
        suggestion: `${text.replace(/[.]$/, '')}. [Add metric: e.g., serves X users / cut latency by Y%].`,
      })
    }
  }
  return flags
}

/** Pure apply — returns a new ResumeData with the flag's suggestion applied. */
export function applyMetricSuggestion(data: ResumeData, flagId: string): ResumeData {
  const next: ResumeData = JSON.parse(JSON.stringify(data))
  const flag = analyzeResume(data).find((f) => f.id === flagId)
  if (!flag) return next
  if (flag.section === 'experience') {
    const exp = next.experience.find((e) => e.id === flag.parentId)
    if (exp && flag.index >= 0 && flag.index < exp.bullets.length) {
      exp.bullets[flag.index] = flag.suggestion
      next.updatedAt = new Date().toISOString()
    }
  } else {
    const proj = next.projects.find((p) => p.id === flag.parentId)
    if (proj) {
      proj.description = flag.suggestion.slice(0, 500)
      next.updatedAt = new Date().toISOString()
    }
  }
  return next
}

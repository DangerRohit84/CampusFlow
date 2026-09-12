import { describe, it, expect } from 'vitest'
import { hasMetric, quantifyRewrite, analyzeResume, applyMetricSuggestion } from '../metricCoach'
import type { ResumeData } from '../../../types/resume'
import { emptyResumeData } from '../../resumeStorage'

function sample(): ResumeData {
  const d = emptyResumeData()
  d.experience = [
    { id: 'e1', role: 'Intern', company: 'Acme', location: '', startDate: '', endDate: '', bullets: ['built dashboard', 'Reduced load time by 30% via caching.'] },
  ]
  d.projects = [
    { id: 'p1', title: 'Shop', description: '', tech: ['React'], link: '', date: '' },
    { id: 'p2', title: 'API', description: 'REST API serving 10k req/day.', tech: ['Node'], link: '', date: '' },
  ]
  return d
}

describe('metricCoach', () => {
  it('hasMetric detects digits only (no number -> false)', () => {
    expect(hasMetric('Built dashboard')).toBe(false)
    expect(hasMetric('Reduced load by 30%')).toBe(true)
    expect(hasMetric('Serves 10k users')).toBe(true)
  })

  it('quantifyRewrite keeps facts, ensures verb+period, appends bracketed placeholder (no fake numbers)', () => {
    const out = quantifyRewrite('dashboard for sales team', 0)
    expect(out).toMatch(/^[A-Z]/)
    expect(out.endsWith('.')).toBe(true)
    expect(out).toContain('[Add metric:')
    expect(out).not.toMatch(/30%|10k/)
  })

  it('quantifyRewrite leaves already-quantified bullets without placeholder', () => {
    const out = quantifyRewrite('Reduced load time by 30% via caching.', 1)
    expect(out).not.toContain('[Add metric:')
  })

  it('analyzeResume flags unquantified bullets + empty project desc, skips quantified', () => {
    const flags = analyzeResume(sample())
    const ids = flags.map((f) => f.id)
    expect(ids).toContain('experience:e1:0')
    expect(ids).not.toContain('experience:e1:1')
    expect(ids).toContain('projects:p1:desc')
    expect(ids).not.toContain('projects:p2:desc')
  })

  it('applyMetricSuggestion replaces only the flagged bullet (pure, no mutation)', () => {
    const before = sample()
    const snapshot = JSON.stringify(before)
    const next = applyMetricSuggestion(before, 'experience:e1:0')
    expect(JSON.stringify(before)).toBe(snapshot) // no mutation
    expect(next.experience[0].bullets[0]).not.toBe(before.experience[0].bullets[0])
    expect(next.experience[0].bullets[1]).toBe(before.experience[0].bullets[1]) // untouched
    expect(next.projects[0].description).toBe(before.projects[0].description)
  })

  it('applyMetricSuggestion is a no-op for unknown flag ids', () => {
    const before = sample()
    const next = applyMetricSuggestion(before, 'experience:nope:9')
    expect(next).toEqual(before)
  })
})

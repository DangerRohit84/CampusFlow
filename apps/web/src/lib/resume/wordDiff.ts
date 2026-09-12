// lib/resume/wordDiff.ts — word-level diff for ATS/tailor Apply-per-change preview.
// Pure, tested. LCS over word tokens (resumes are small: <500 words per field,
// so O(n*m) DP is fine). No deps, no hallucination — verbatim token compare.

export type DiffTokenType = 'same' | 'add' | 'del'

export type DiffToken = {
  type: DiffTokenType
  /** space-joined run of words of the same type */
  text: string
}

export function tokenizeWords(text: string): string[] {
  return String(text || '')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
}

/**
 * LCS-based word diff. Returns merged runs (consecutive same-type words joined).
 * BEFORE/AFTER are treated verbatim — no normalization beyond whitespace split,
 * so the preview is grounded in exactly what AI/heuristic produced.
 */
export function diffWords(before: string, after: string): DiffToken[] {
  const a = tokenizeWords(before)
  const b = tokenizeWords(after)
  if (a.length === 0 && b.length === 0) return []
  if (a.length === 0) return b.length ? [{ type: 'add', text: b.join(' ') }] : []
  if (b.length === 0) return [{ type: 'del', text: a.join(' ') }]

  const n = a.length
  const m = b.length
  // DP table of LCS lengths (suffix-based for simple backtrack)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  type Raw = { type: DiffTokenType; word: string }
  const raw: Raw[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'same', word: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'del', word: a[i] })
      i++
    } else {
      raw.push({ type: 'add', word: b[j] })
      j++
    }
  }
  while (i < n) raw.push({ type: 'del', word: a[i++] })
  while (j < m) raw.push({ type: 'add', word: b[j++] })

  // Merge consecutive same-type runs for compact rendering
  const merged: DiffToken[] = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    if (last && last.type === r.type) last.text += ' ' + r.word
    else merged.push({ type: r.type, text: r.word })
  }
  return merged
}

export function countDiffChanges(tokens: DiffToken[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const t of tokens) {
    const words = t.text ? t.text.split(/\s+/).length : 0
    if (t.type === 'add') added += words
    if (t.type === 'del') removed += words
  }
  return { added, removed }
}

/** True when there is any add/del (used to hide "no changes" rows). */
export function hasDiffChanges(tokens: DiffToken[]): boolean {
  return tokens.some((t) => t.type !== 'same')
}

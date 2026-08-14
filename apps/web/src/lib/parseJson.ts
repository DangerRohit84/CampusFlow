/**
 * Safely parse a value that may be a JSON array, comma-separated string, or actual array.
 * Returns a string array.
 */
export function parseJsonArray(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return val.split(',').map((s: string) => s.trim()).filter(Boolean)
    }
  }
  return []
}

/**
 * Safely parse a value that may be a JSON array, comma-separated string, or actual array.
 * Returns a number array.
 */
export function parseJsonNumberArray(val: unknown): number[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(Number).filter((n) => !isNaN(n))
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) ? parsed.map(Number).filter((n: number) => !isNaN(n)) : []
    } catch {
      return val.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    }
  }
  return []
}

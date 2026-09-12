// lib/logger.ts — frontend structured logger (Track 4 I-7 fix).
// WHY: AdminPage + resources/* used bare `console.error` in prod paths (no
// requestId/context, noisy in prod). Single logger with levels + redaction so
// callers pass context, not PII. Dev: console; prod: console + no PII.
// Replaces `console.*` in touched files (AdminPage, api/*).

type LogContext = Record<string, unknown>

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    // Never log tokens/keys verbatim (keep prefix for debugging).
    if (/^(gsk_|sk-|Bearer\s)/i.test(value)) return '[redacted]'
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value
  }
  if (value instanceof Error) return { name: value.name, message: value.message }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/password|token|authorization|cookie|apiKey|groq/i.test(k)) out[k] = '[redacted]'
      else if (/email/i.test(k)) out[k] = '[redacted-email]'
      else out[k] = redact(v)
    }
    return out
  }
  return value
}

function emit(level: 'debug' | 'info' | 'warn' | 'error', msg: string, ctx?: LogContext): void {
  try {
    const payload = ctx ? redact(ctx) : undefined
    if (import.meta.env.DEV) {
      // DEV: full context for debugging.
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'debug' : level](`[${level}] ${msg}`, payload ?? '')
    } else {
      // PROD: error/warn only, no PII.
      if (level === 'error' || level === 'warn') {
        // eslint-disable-next-line no-console
        console[level](`[${level}] ${msg}`, payload ?? '')
      }
    }
  } catch {
    /* logger never throws */
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit('error', msg, ctx),
}

export default logger

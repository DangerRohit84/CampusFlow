import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as any)?.requestId
  // Gracefully handle body-parser / express.json SyntaxErrors (e.g., client sent "null" with strict:true,
  // or malformed JSON). These are client errors (400), not 500s. Log as warn to avoid noisy 500 stacks
  // on every client connect when frontend does `api.post(url, null)` -> JSON.stringify(null) == "null".
  const isJsonParseError =
    (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) ||
    err?.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && typeof err.message === 'string' && err.message.includes('Unexpected token'))

  if (isJsonParseError) {
    const status = err.status || 400
    // Warn not error — prevents "Error: Unexpected token 'n', \"null\" is not valid JSON" noise in logs.
    // Static message only: never echo raw body (could contain PII) — see FS-L04.
    logger.warn({ requestId, status }, 'Invalid JSON body')
    if (!res.headersSent) {
      res.status(status).json({
        error: 'Invalid JSON body',
      })
    }
    return
  }

  logger.error({ requestId, status: err.status || 500 }, 'Request failed')

  const isDev = process.env.NODE_ENV === 'development'

  if (!res.headersSent) {
    // I-7 fix: never echo raw 400 message (may contain field values/PII).
    // Prod returns generic code + requestId; full message stays in server logs.
    const status = err.status || 500
    const safeError = status === 400 ? 'Validation failed' : status === 413 ? 'Payload too large' : status === 429 ? 'Too many requests' : 'Internal server error'
    res.status(status).json({
      error: isDev ? (err.message || safeError) : safeError,
      code: status === 400 ? 'INVALID_INPUT' : status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
      requestId: requestId || undefined,
      message: undefined,
    })
  }
}
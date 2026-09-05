import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  // Gracefully handle body-parser / express.json SyntaxErrors (e.g., client sent "null" with strict:true,
  // or malformed JSON). These are client errors (400), not 500s. Log as warn to avoid noisy 500 stacks
  // on every client connect when frontend does `api.post(url, null)` -> JSON.stringify(null) == "null".
  const isJsonParseError =
    (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) ||
    err?.type === 'entity.parse.failed' ||
    (err instanceof SyntaxError && typeof err.message === 'string' && err.message.includes('Unexpected token'))

  if (isJsonParseError) {
    const status = err.status || 400
    // Warn not error — prevents "Error: Unexpected token 'n', \"null\" is not valid JSON" noise in logs
    console.warn(`[Bad JSON] ${status} ${err.message?.slice(0, 200)}`)
    if (!res.headersSent) {
      res.status(status).json({
        error: 'Invalid JSON body',
        message: err.message,
      })
    }
    return
  }

  console.error('Error:', err.message)
  console.error(err.stack)

  const isDev = process.env.NODE_ENV === 'development'

  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.status === 400 ? err.message : 'Internal server error',
      message: isDev ? err.message : undefined,
    })
  }
}
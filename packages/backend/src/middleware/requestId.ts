import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string
    }
  }
}

// X-Request-Id middleware (F20 observability).
// WHY: correlates logs across index/auth/errorHandler + lets clients quote an ID on 4xx/5xx.
// Propagates inbound X-Request-Id if present, else assigns randomUUID. Always echoes header.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id']
  const id =
    (Array.isArray(inbound) ? inbound[0] : inbound)?.toString().trim() || randomUUID()
  req.requestId = id
  res.setHeader('X-Request-Id', id)
  next()
}

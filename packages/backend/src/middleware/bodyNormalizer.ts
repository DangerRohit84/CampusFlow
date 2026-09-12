// middleware/bodyNormalizer.ts — SRP extract from index.ts (was inline).
// Normalizes primitive JSON bodies so downstream handlers never see null.
import type { NextFunction, Request, Response } from 'express'

export function bodyNormalizer(req: Request, _res: Response, next: NextFunction): void {
  if (req.body === null || req.body === undefined) {
    ;(req as unknown as { body: unknown }).body = {}
  } else if (typeof req.body !== 'object') {
    ;(req as unknown as { body: unknown }).body = {}
  }
  next()
}

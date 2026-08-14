import { Request, Response, NextFunction } from 'express'

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  console.error('Error:', err.message)
  console.error(err.stack)

  const isDev = process.env.NODE_ENV === 'development'

  res.status(500).json({
    error: 'Internal server error',
    message: isDev ? err.message : undefined,
  })
}
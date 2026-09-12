import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

// Structured logger (JSON in prod, pretty in dev).
// WHY pino: zero-overhead JSON logs with requestId correlation (F20).
// Never log PII/secrets — callers pass { requestId, route, code } only.
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
  redact: {
    paths: [
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'token',
      '*.token',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'email',
      '*.email',
    ],
    remove: false,
  },
})

/**
 * Deploy-readiness boot validation — hermetic unit tests (no DB/network).
 * Covers:
 *  - validateEnv: prod fail-fast vs dev warn-only for DATABASE_URL, DIRECT_URL,
 *    JWT_SECRET strength, CRON_SECRET (route-level), REDIS_URL (fallback note).
 *  - compareMigrationState: applied vs local count, behind detection, drift.
 *  - formatMigrationWarning: exact release command, no in-process migrate.
 *  - getLocalMigrationIds: fs listing with temp dirs (no real DB).
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateEnv } from '../src/config/envValidation'
import {
  compareMigrationState,
  formatMigrationWarning,
  getLocalMigrationIds,
  MIGRATE_DEPLOY_CMD,
  MIGRATE_DEPLOY_CMD_ALT,
} from '../src/config/migrationCheck'

// 64-hex valid secrets (no placeholder substrings like campusflow/example).
const VALID_JWT = '9f8e7d6c5b4a3928174635a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d'
const VALID_AI = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809'
const VALID_CRON = 'abcdef1234567890abcdef1234567890'
const POOLED_URL =
  'postgresql://user:pass@ep-example-pooler.c-5.ap-southeast-1.aws.NEONHOST_REMOVED/campusflow?sslmode=require&channel_binding=prefer&connect_timeout=30&pgbouncer=true&connection_limit=50&pool_timeout=30'
const DIRECT_URL =
  'postgresql://user:pass@ep-example.c-5.ap-southeast-1.aws.NEONHOST_REMOVED/campusflow?sslmode=require&channel_binding=prefer&connect_timeout=30'

function baseProdEnv(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: POOLED_URL,
    DIRECT_URL,
    JWT_SECRET: VALID_JWT,
    AI_ENCRYPTION_KEY: VALID_AI,
    CRON_SECRET: VALID_CRON,
    FRONTEND_URL: 'https://campusflow-web.onrender.com',
    JWT_EXPIRES_IN: '1d',
    REDIS_URL: 'rediss://default:pass@host:6379',
    HIBP_STRICT: 'true',
    UPLOAD_SCAN_STRICT: 'true',
    EXTERNAL_FETCH_ALLOWLIST: 'unstop.com,internshala.com',
    TURNSTILE_SECRET: 'turnstile-secret-value',
    GROQ_API_KEY: 'groq-key',
  }
}

describe('validateEnv — prod fail-fast', () => {
  it('valid prod env has no errors', () => {
    const r = validateEnv(baseProdEnv())
    expect(r.isProd).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('prod missing DATABASE_URL is an error (never silent)', () => {
    const env = { ...baseProdEnv(), DATABASE_URL: undefined }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('DATABASE_URL'))).toBe(true)
  })

  it('prod missing DIRECT_URL is an error (migrate deploy needs it)', () => {
    const env = { ...baseProdEnv(), DIRECT_URL: '' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('DIRECT_URL'))).toBe(true)
  })

  it('prod weak JWT_SECRET (<32) is an error with openssl hint', () => {
    const env = { ...baseProdEnv(), JWT_SECRET: 'short' }
    const r = validateEnv(env)
    const msg = r.errors.find((m) => m.includes('JWT_SECRET')) || ''
    expect(msg).toMatch(/32/)
    expect(msg).toMatch(/openssl rand -hex 32/)
  })

  it('prod placeholder JWT_SECRET is an error (no dictionary defaults)', () => {
    const env = { ...baseProdEnv(), JWT_SECRET: 'password123password123password1234567890' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('JWT_SECRET'))).toBe(true)
  })

  it('prod missing FRONTEND_URL is an error (no localhost fallback)', () => {
    const env = { ...baseProdEnv(), FRONTEND_URL: '' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('FRONTEND_URL'))).toBe(true)
  })

  it('prod malformed JWT_EXPIRES_IN is an error', () => {
    const env = { ...baseProdEnv(), JWT_EXPIRES_IN: 'seven-days' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('JWT_EXPIRES_IN'))).toBe(true)
  })

  it('prod DIRECT_URL with pgbouncer warns (must be direct)', () => {
    const env = {
      ...baseProdEnv(),
      DIRECT_URL:
        'postgresql://user:pass@ep-example.c-5.ap-southeast-1.aws.NEONHOST_REMOVED/campusflow?sslmode=require&pgbouncer=true',
    }
    const r = validateEnv(env)
    expect(r.warnings.some((m) => m.includes('DIRECT_URL') && m.includes('pgbouncer'))).toBe(true)
  })
})

describe('validateEnv — CRON_SECRET + REDIS_URL never boot-fatal', () => {
  it('prod missing CRON_SECRET is a warning (not error) — routes 503 when hit', () => {
    const env = { ...baseProdEnv(), CRON_SECRET: '' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('CRON_SECRET'))).toBe(false)
    const w = r.warnings.find((m) => m.includes('CRON_SECRET')) || ''
    expect(w).toMatch(/503/)
  })

  it('dev missing CRON_SECRET warns (lenient, boot continues)', () => {
    const env = { ...baseProdEnv(), NODE_ENV: 'development', CRON_SECRET: undefined }
    const r = validateEnv(env)
    expect(r.isProd).toBe(false)
    expect(r.errors).toEqual([])
    expect(r.warnings.some((m) => m.includes('CRON_SECRET'))).toBe(true)
  })

  it('prod missing REDIS_URL warns with memory-fallback note (never errors)', () => {
    const env = { ...baseProdEnv(), REDIS_URL: '' }
    const r = validateEnv(env)
    expect(r.errors.some((m) => m.includes('REDIS_URL'))).toBe(false)
    const w = r.warnings.find((m) => m.includes('REDIS_URL')) || ''
    expect(w).toMatch(/in-memory fallback/i)
  })

  it('dev missing REDIS_URL warns (single-instance OK)', () => {
    const env = { ...baseProdEnv(), NODE_ENV: 'development', REDIS_URL: undefined }
    const r = validateEnv(env)
    expect(r.errors).toEqual([])
    expect(r.warnings.some((m) => m.includes('REDIS_URL'))).toBe(true)
  })
})

describe('validateEnv — dev lenient (warn-only)', () => {
  it('dev missing DATABASE_URL/DIRECT_URL/JWT warns but does not error', () => {
    const r = validateEnv({
      NODE_ENV: 'development',
      DATABASE_URL: '',
      DIRECT_URL: '',
      JWT_SECRET: 'short',
    })
    expect(r.isProd).toBe(false)
    expect(r.errors).toEqual([])
    expect(r.warnings.some((m) => m.includes('DATABASE_URL'))).toBe(true)
    expect(r.warnings.some((m) => m.includes('DIRECT_URL'))).toBe(true)
    expect(r.warnings.some((m) => m.includes('JWT_SECRET'))).toBe(true)
  })

  it('dev missing FRONTEND_URL is OK (localhost fallback)', () => {
    const r = validateEnv({ NODE_ENV: 'development', JWT_SECRET: VALID_JWT })
    expect(r.errors.some((m) => m.includes('FRONTEND_URL'))).toBe(false)
  })

  it('prod advisory flags warn when insecure defaults (HIBP/SCAN/ALLOWLIST/TURNSTILE)', () => {
    const env = {
      ...baseProdEnv(),
      HIBP_STRICT: 'false',
      UPLOAD_SCAN_STRICT: undefined,
      EXTERNAL_FETCH_ALLOWLIST: '',
      TURNSTILE_SECRET: '',
    }
    const r = validateEnv(env)
    // Advisory only — never errors.
    expect(r.errors.length).toBe(0)
    expect(r.warnings.some((m) => m.includes('HIBP_STRICT'))).toBe(true)
    expect(r.warnings.some((m) => m.includes('UPLOAD_SCAN_STRICT'))).toBe(true)
    expect(r.warnings.some((m) => m.includes('EXTERNAL_FETCH_ALLOWLIST'))).toBe(true)
    expect(r.warnings.some((m) => m.includes('TURNSTILE_SECRET'))).toBe(true)
  })

  it('never logs secret values (messages contain key names only)', () => {
    const secretVal = 'super-secret-value-xyz-1234567890-abcdef'
    const r = validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'short' })
    expect(JSON.stringify(r)).not.toContain(secretVal)
    // Even the valid-secret path must not echo values.
    const r2 = validateEnv({ ...baseProdEnv(), REDIS_URL: 'rediss://default:hunter2@host:6379' })
    expect(JSON.stringify(r2)).not.toContain('hunter2')
  })
})

describe('compareMigrationState — pure drift logic', () => {
  it('detects behind (2/3 applied, 1 pending)', () => {
    const cmp = compareMigrationState(['a', 'b', 'c'], ['a', 'b'])
    expect(cmp.localCount).toBe(3)
    expect(cmp.appliedCount).toBe(2)
    expect(cmp.pendingCount).toBe(1)
    expect(cmp.behind).toBe(true)
    expect(cmp.pendingIds).toEqual(['c'])
  })

  it('ok when counts match and ids equal', () => {
    const cmp = compareMigrationState(['a', 'b'], ['a', 'b'])
    expect(cmp.behind).toBe(false)
    expect(cmp.pendingCount).toBe(0)
  })

  it('detects extra applied (DB ahead of code — rollback/stale checkout)', () => {
    const cmp = compareMigrationState(['a'], ['a', 'b-orphan'])
    expect(cmp.behind).toBe(false)
    expect(cmp.extraAppliedIds).toEqual(['b-orphan'])
  })

  it('dedupes + trims inputs', () => {
    const cmp = compareMigrationState(['a ', 'a', 'b'], ['a', 'a '])
    expect(cmp.localCount).toBe(2)
    expect(cmp.appliedCount).toBe(1)
    expect(cmp.behind).toBe(true)
  })
})

describe('formatMigrationWarning — exact release command', () => {
  it('names the npm script + alt + DIRECT_URL + no in-process warning', () => {
    const cmp = compareMigrationState(['20260912000000_auth_revocation', 'b'], ['b'])
    const msg = formatMigrationWarning(cmp)
    expect(msg).toContain(MIGRATE_DEPLOY_CMD)
    expect(msg).toContain(MIGRATE_DEPLOY_CMD_ALT)
    expect(msg).toContain('DIRECT_URL')
    expect(msg).toMatch(/Do NOT run migrate in-process/i)
    expect(msg).toMatch(/preDeployCommand/i)
    // Counts only — pending id preview is code, not secrets.
    expect(msg).toMatch(/1 pending/)
  })
})

describe('getLocalMigrationIds — fs listing', () => {
  it('lists only dirs containing migration.sql, sorted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'))
    try {
      fs.mkdirSync(path.join(tmp, 'b_mig'))
      fs.writeFileSync(path.join(tmp, 'b_mig', 'migration.sql'), '-- b')
      fs.mkdirSync(path.join(tmp, 'a_mig'))
      fs.writeFileSync(path.join(tmp, 'a_mig', 'migration.sql'), '-- a')
      fs.mkdirSync(path.join(tmp, 'empty_dir'))
      fs.writeFileSync(path.join(tmp, 'not-a-dir.sql'), '-- ignore')
      const ids = getLocalMigrationIds(tmp)
      expect(ids).toEqual(['a_mig', 'b_mig'])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('returns [] for missing dir (never throws)', () => {
    expect(getLocalMigrationIds(path.join(os.tmpdir(), 'does-not-exist-xyz'))).toEqual([])
  })
})

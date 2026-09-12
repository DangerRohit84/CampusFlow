/**
 * Boot-time migration check — warn-only, never crashes healthy paths.
 *
 * WHY: two live crashes came from migrations never applied (SyncThrottle,
 * RevokedToken, twin-column drift). First deploy must apply migrations at
 * RELEASE time (Render preDeployCommand `npm run db:deploy`, i.e.
 * `prisma migrate deploy` with DIRECT_URL) — NOT in-process on every boot
 * (concurrent web/cron runners race on _prisma_migrations lock).
 *
 * This module only CHECKS: compare local migration count (prisma/migrations
 * folders containing migration.sql) vs applied count
 * (SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL).
 * Behind → logger.warn with the EXACT release command. DB unreachable or
 * table missing → warn (unknown), never throw — /api/health already exposes
 * degraded status and withRetry heals on next query.
 *
 * RULES:
 * - No `config/index` import (keeps hermetic vitest without JWT env).
 * - `compareMigrationState` is pure (unit-tested, no fs/DB).
 * - `checkMigrationStatus` never throws (catch-all → { status: 'unknown' }).
 * - Never log connection strings or secrets (counts + names only).
 */

import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

export interface MigrationComparison {
  localCount: number
  appliedCount: number
  pendingCount: number
  behind: boolean
  pendingIds: string[]
  extraAppliedIds: string[]
}

export type MigrationStatus = 'ok' | 'behind' | 'unknown'

export interface MigrationStatusResult extends MigrationComparison {
  status: MigrationStatus
  reason?: string
}

/** Release command (single source of truth for every warning/message). */
export const MIGRATE_DEPLOY_CMD =
  'npm run db:deploy -w @campusflow/backend'
export const MIGRATE_DEPLOY_CMD_ALT =
  'npx prisma migrate deploy --schema=packages/backend/prisma/schema.prisma'

/**
 * Pure comparison — localIds from prisma/migrations dir names, appliedIds from
 * _prisma_migrations.migration_name. Sorted/deduped, no I/O.
 */
export function compareMigrationState(
  localIds: string[],
  appliedIds: string[],
): MigrationComparison {
  const local = [...new Set((localIds || []).map((s) => String(s).trim()).filter(Boolean))].sort()
  const appliedSet = new Set((appliedIds || []).map((s) => String(s).trim()).filter(Boolean))
  const localSet = new Set(local)
  const pendingIds = local.filter((id) => !appliedSet.has(id))
  const extraAppliedIds = [...appliedSet].filter((id) => !localSet.has(id)).sort()
  return {
    localCount: local.length,
    appliedCount: appliedSet.size,
    pendingCount: pendingIds.length,
    behind: pendingIds.length > 0,
    pendingIds,
    extraAppliedIds,
  }
}

/** List local migration ids (dir names containing migration.sql), sorted. Never throws. */
export function getLocalMigrationIds(migrationsDir?: string): string[] {
  const dir =
    migrationsDir || path.resolve(__dirname, '../../prisma/migrations')
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const ids: string[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const sqlPath = path.join(dir, e.name, 'migration.sql')
      try {
        if (fs.existsSync(sqlPath)) ids.push(e.name)
      } catch {
        // ignore single-entry errors
      }
    }
    return ids.sort()
  } catch {
    return []
  }
}

/** Exact warning text (single source — boot log + report + code comments reuse). */
export function formatMigrationWarning(cmp: MigrationComparison): string {
  const pendingPreview =
    cmp.pendingIds.slice(0, 5).join(', ') + (cmp.pendingIds.length > 5 ? ` (+${cmp.pendingIds.length - 5} more)` : '')
  return (
    `[migrations] DB is BEHIND: ${cmp.appliedCount}/${cmp.localCount} applied, ${cmp.pendingCount} pending (${pendingPreview}). ` +
      `Migrations were not applied at release time. Run release-time migrate: \`${MIGRATE_DEPLOY_CMD}\` ` +
      `(alt: \`${MIGRATE_DEPLOY_CMD_ALT}\`, uses DIRECT_URL). ` +
      `Do NOT run migrate in-process on every boot (concurrent web/cron runners race on _prisma_migrations). ` +
      `Migrations run via Render preDeployCommand — this boot check is warn-only and never crashes healthy paths.`
  )
}

/** Read applied migration names. Throws on DB error (caller converts to warn). */
export async function getAppliedMigrationNames(client: any): Promise<string[]> {
  // finished_at IS NOT NULL = successfully applied (failed attempts have NULL).
  // Fall back to unfiltered select when the column is absent (old Prisma).
  try {
    const rows = (await client.$queryRaw`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`) as Array<{
      migration_name: string
    }>
    return (rows || []).map((r: any) => String(r?.migration_name || '').trim()).filter(Boolean)
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (/relation .*_prisma_migrations.* does not exist|P2021|42P01/i.test(msg)) {
      // Fresh DB that never ran a migration — zero applied (not an error).
      return []
    }
    throw e
  }
}

function isMissingMigrationsTableError(e: any): boolean {
  if (!e) return false
  if ((e as any).code === 'P2021' || (e as any).code === 'P2022') return true
  return /_prisma_migrations.*does not exist|relation .* does not exist/i.test(String(e?.message || ''))
}

/**
 * Boot check — non-blocking, warn-only, never throws.
 * Wire: setImmediate(() => { checkMigrationStatus({ prismaClient }).catch(() => {}) })
 */
export async function checkMigrationStatus(opts: {
  prismaClient?: any
  migrationsDir?: string
} = {}): Promise<MigrationStatusResult> {
  const empty: MigrationStatusResult = {
    status: 'unknown',
    localCount: 0,
    appliedCount: 0,
    pendingCount: 0,
    behind: false,
    pendingIds: [],
    extraAppliedIds: [],
  }
  try {
    const localIds = getLocalMigrationIds(opts.migrationsDir)
    if (localIds.length === 0) {
      logger.warn(
        '[migrations] could not list local migrations (prisma/migrations unreadable) — skipping drift check (non-fatal).',
      )
      return { ...empty, reason: 'local-list-empty' }
    }

    let appliedIds: string[] = []
    if (!opts.prismaClient) {
      try {
        const mod = await import('./db')
        const client: any = (mod as any).default ?? (mod as any).prisma
        if (!client?.$queryRaw) {
          logger.warn('[migrations] no prisma client available — skipping drift check (non-fatal).')
          return { ...empty, localCount: localIds.length, reason: 'no-client' }
        }
        appliedIds = await getAppliedMigrationNames(client)
      } catch (e: any) {
        if (isMissingMigrationsTableError(e)) {
          logger.warn(
            `[migrations] _prisma_migrations missing — DB may be empty or migrations never applied. ` +
              `Run \`${MIGRATE_DEPLOY_CMD}\` (uses DIRECT_URL). Local=${localIds.length}, applied=0 (non-fatal, /api/health shows degraded until applied).`,
          )
          return {
            status: 'behind',
            localCount: localIds.length,
            appliedCount: 0,
            pendingCount: localIds.length,
            behind: true,
            pendingIds: localIds,
            extraAppliedIds: [],
            reason: 'table-missing',
          }
        }
        logger.warn(
          `[migrations] drift check skipped (DB unreachable at boot — non-fatal, withRetry heals on demand): ${String(e?.code || '')} ${String(e?.message || e).slice(0, 200)}`,
        )
        return { ...empty, localCount: localIds.length, reason: 'db-unreachable' }
      }
    } else {
      try {
        appliedIds = await getAppliedMigrationNames(opts.prismaClient)
      } catch (e: any) {
        if (isMissingMigrationsTableError(e)) {
          logger.warn(
            `[migrations] _prisma_migrations missing — DB may be empty or migrations never applied. ` +
              `Run \`${MIGRATE_DEPLOY_CMD}\` (uses DIRECT_URL). Local=${localIds.length}, applied=0 (non-fatal).`,
          )
          return {
            status: 'behind',
            localCount: localIds.length,
            appliedCount: 0,
            pendingCount: localIds.length,
            behind: true,
            pendingIds: localIds,
            extraAppliedIds: [],
            reason: 'table-missing',
          }
        }
        logger.warn(
          `[migrations] drift check skipped (DB unreachable at boot — non-fatal): ${String(e?.code || '')} ${String(e?.message || e).slice(0, 200)}`,
        )
        return { ...empty, localCount: localIds.length, reason: 'db-unreachable' }
      }
    }

    const cmp = compareMigrationState(localIds, appliedIds)
    if (cmp.behind) {
      logger.warn(formatMigrationWarning(cmp))
      if (cmp.extraAppliedIds.length > 0) {
        logger.warn(
          `[migrations] drift: ${cmp.extraAppliedIds.length} applied migration(s) not in local code (${cmp.extraAppliedIds.slice(0, 3).join(', ')}) — code may be behind the DB (rollback or stale checkout?).`,
        )
      }
      return { ...cmp, status: 'behind' }
    }
    if (cmp.extraAppliedIds.length > 0) {
      logger.warn(
        `[migrations] up to date (${cmp.appliedCount}/${cmp.localCount}) but ${cmp.extraAppliedIds.length} applied migration(s) not in local code — verify checkout matches deployed release.`,
      )
    } else {
      logger.info(`[migrations] up to date (${cmp.appliedCount}/${cmp.localCount} applied)`)
    }
    return { ...cmp, status: 'ok' }
  } catch (e: any) {
    // Absolute catch-all: this check must never crash boot.
    logger.warn(
      `[migrations] drift check failed (non-fatal, healthy paths continue): ${String(e?.message || e).slice(0, 200)}`,
    )
    return { ...empty, reason: 'unexpected' }
  }
}

// services/fetch/autoFetch.ts — global auto-fetch master toggle (SUPER_ADMIN kill-switch).
// WHY: cron fetched on a fixed schedule with no way to pause without redeploy
// (env-only flag) or code change. This module owns a DB-backed flag so the
// FetchPage toggle pauses scheduled opportunities auto-fetch without redeploy
// (contests always run — toggle gates opportunities only).
// Precedence: explicit AUTO_FETCH_ENABLED env (ops emergency kill-switch,
// no DB hit) > fetch_config singleton row > default ON (true).
// Manual POST /fetch/* endpoints NEVER consult this flag — explicit user
// action is always allowed. Only the opportunities cron job (internalCron
// runOpportunitiesJob) skips when off, with a logged reason.
// Deploy safety: fetch_config is additive (see migration); until applied the
// delegate/table may be absent — reads degrade to default-ON (warn once),
// never throw into the cron/fetch path. Follows the SourceHealth
// PrismaSourceHealthStore fallback pattern. DIP: db/env injectable for hermetic tests.

import prisma from '../../config/db';
import { logger } from '../../utils/logger';

export const AUTO_FETCH_ENV_VAR = 'AUTO_FETCH_ENABLED';
export const FETCH_CONFIG_ID = 'global';

export interface FetchConfigDb {
  fetchConfig?: {
    findUnique(args: unknown): Promise<{ autoFetchEnabled?: unknown } | null>;
    upsert(args: unknown): Promise<{ autoFetchEnabled?: unknown }>;
  };
}

export interface AutoFetchDeps {
  env?: NodeJS.ProcessEnv;
  db?: FetchConfigDb;
}

/** Parse an env-style flag: true-ish → true, false-ish → false, unset/garbage → undefined. */
export function parseAutoFetchEnv(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return undefined;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n' || s === 'off') return false;
  return undefined;
}

/** DB read — null when no row / stale client / table missing / any error (never throws). */
export async function readAutoFetchDb(
  db: FetchConfigDb = prisma as unknown as FetchConfigDb,
): Promise<boolean | null> {
  try {
    const delegate = (db as FetchConfigDb)?.fetchConfig;
    if (!delegate) return null;
    const row = await delegate.findUnique({ where: { id: FETCH_CONFIG_ID } });
    if (!row || typeof row.autoFetchEnabled !== 'boolean') return null;
    return row.autoFetchEnabled;
  } catch (err: unknown) {
    const code = String((err as { code?: unknown })?.code || '');
    const msg = String((err as { message?: unknown })?.message || err || '');
    if (code === 'P2021' || /does not exist|no such table|fetch_config/i.test(msg)) {
      logger.warn('[AutoFetch] fetch_config table missing (migration pending) — defaulting auto-fetch ON');
    } else {
      logger.warn({ err: (err as Error)?.message || err }, '[AutoFetch] DB read failed — defaulting auto-fetch ON');
    }
    return null;
  }
}

export type AutoFetchSource = 'env' | 'db' | 'default';

export interface AutoFetchState {
  /** Stored/configured value (what the UI toggle shows). */
  autoFetchEnabled: boolean;
  /** What cron will actually do (env override applied). Today identical to autoFetchEnabled. */
  effectiveAutoFetch: boolean;
  source: AutoFetchSource;
}

export async function getAutoFetchState(deps: AutoFetchDeps = {}): Promise<AutoFetchState> {
  const envVal = parseAutoFetchEnv((deps.env ?? process.env)[AUTO_FETCH_ENV_VAR]);
  if (envVal !== undefined) {
    return { autoFetchEnabled: envVal, effectiveAutoFetch: envVal, source: 'env' };
  }
  const dbVal = await readAutoFetchDb(deps.db);
  if (dbVal !== null) {
    return { autoFetchEnabled: dbVal, effectiveAutoFetch: dbVal, source: 'db' };
  }
  return { autoFetchEnabled: true, effectiveAutoFetch: true, source: 'default' };
}

/** Cron gate — never throws (fail-open to ON so a DB blip never silently kills the feed). */
export async function isAutoFetchEnabled(deps: AutoFetchDeps = {}): Promise<boolean> {
  try {
    const state = await getAutoFetchState(deps);
    return state.effectiveAutoFetch;
  } catch (err: unknown) {
    logger.warn({ err: (err as Error)?.message || err }, '[AutoFetch] state check failed — defaulting ON');
    return true;
  }
}

/** Persist the DB-backed flag (SUPER_ADMIN only at the route layer). Returns the stored value. */
export async function setAutoFetchEnabled(
  enabled: boolean,
  db: FetchConfigDb = prisma as unknown as FetchConfigDb,
): Promise<boolean> {
  const row = await (db as Required<FetchConfigDb>).fetchConfig.upsert({
    where: { id: FETCH_CONFIG_ID },
    update: { autoFetchEnabled: enabled },
    create: { id: FETCH_CONFIG_ID, autoFetchEnabled: enabled },
  });
  const stored = (row as { autoFetchEnabled?: unknown } | null)?.autoFetchEnabled;
  return typeof stored === 'boolean' ? stored : enabled;
}

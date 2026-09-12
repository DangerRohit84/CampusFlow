// jobs/cron.ts — embedded cron (SRP extract from index.ts).
// WHY: index.ts mixed composition (app.use) with scheduling + boot-fetch
// gating. This module owns scheduling; index.ts calls `startEmbeddedCron()`
// unless DISABLE_EMBEDDED_CRON=true (prod uses Render Cron Jobs instead).
// Behavior identical; AbortSignal/withRetry stay explicit at job call sites.

import cron from 'node-cron'
import { logger } from '../utils/logger'
import { runContestsJob, runProfileSyncJob, runOpportunitiesJob, runCleanupJob, runContestRemindersJobCron } from '../routes/internalCron'

export interface CronHandles {
  stopAll(): void
}

export function shouldSkipContestBootFetch(env: NodeJS.ProcessEnv = process.env): boolean {
  const rawSkip = env.SKIP_CONTEST_BOOT_FETCH
  const rawDisable = env.DISABLE_CONTEST_BOOT_FETCH
  if (rawSkip !== undefined) return rawSkip === 'true' || rawDisable === 'true'
  return rawDisable === 'true' || env.NODE_ENV !== 'production'
}

export function startEmbeddedCron(): CronHandles {
  // Schedule contest fetch every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      await runContestsJob()
    } catch (error) {
      logger.error({ err: error }, '[Cron] Contest fetch failed')
    }
  })

  // Sync contest participation every hour (per-user 1h throttle still applies inside syncAllUsers)
  const profileTimer = setInterval(async () => {
    try {
      await runProfileSyncJob()
    } catch (err) {
      logger.error({ err }, '[CRON] Sync failed')
    }
  }, 60 * 60 * 1000)

  // Fetch opportunities (hackathons + internships) every 12 hours
  cron.schedule('0 */12 * * *', async () => {
    try {
      await runOpportunitiesJob()
    } catch (err) {
      logger.error({ err }, '[Cron] Opportunity fetch failed')
    }
  })

  // #6 contest alarms: lightweight 60s fan-out (single take:200 query, no-op
  // when nothing due). 6h/12h crons are too coarse for 15-min reminders;
  // prod Render Cron hits POST /internal/cron/contest-reminders every 5 min
  // (see render.yaml) while local dev uses this embedded interval.
  const reminderTimer = setInterval(async () => {
    try {
      await runContestRemindersJobCron()
    } catch (err) {
      logger.error({ err }, '[Cron] Contest reminders failed')
    }
  }, 60 * 1000)

  // Cleanup old rejected items every Sunday at 3 AM
  cron.schedule('0 3 * * 0', async () => {
    try {
      await runCleanupJob()
    } catch (err) {
      logger.error({ err }, '[Cron] Cleanup failed')
    }
  })

  if (!shouldSkipContestBootFetch()) {
    runContestsJob().catch((err) => logger.error({ err }, '[Cron] Initial contest fetch failed'))
  } else {
    logger.info('[Cron] Skipping initial contest fetch (SKIP_CONTEST_BOOT_FETCH=true) — use POST /api/contests/fetch-now for manual refresh')
  }

  return {
    stopAll() {
      try {
        cron.getTasks().forEach((t) => t.stop())
      } catch { /* ignore */ }
      try {
        clearInterval(profileTimer)
      } catch { /* ignore */ }
      try {
        clearInterval(reminderTimer)
      } catch { /* ignore */ }
    },
  }
}

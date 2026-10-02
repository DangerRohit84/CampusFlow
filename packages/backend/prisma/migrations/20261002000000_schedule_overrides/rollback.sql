-- ROLLBACK for 20261002000000_schedule_overrides (manual, low-traffic window).
-- Drops ONLY the additive override table + enum. NEVER touches "Schedule".
-- Pre-rollback census: SELECT count(*) FROM "Schedule"; must match after.
-- Post-rollback: new code degrades to templates-only (P2021 fallback), old code unaffected.
-- Run with DIRECT_URL (non-pooled).

DROP TABLE IF EXISTS "ScheduleOverride";
DO $$ BEGIN
  DROP TYPE IF EXISTS "ScheduleOverrideKind";
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Verify: SELECT count(*) FROM "Schedule"; (unchanged)
-- Verify: SELECT count(*) FROM pg_type WHERE typname = 'ScheduleOverrideKind'; → 0

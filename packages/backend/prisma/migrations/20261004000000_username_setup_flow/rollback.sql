-- ROLLBACK for 20261004000000_username_setup_flow (manual, ops-only).
-- Drops the two additive columns. WARNING: drops change-budget history
-- (counts reset to implicit 0/false on re-migrate). App code is
-- pre-migration safe ((prisma as any) + P2022 fallback), so rollback does
-- NOT require a code revert first — routes degrade to legacy unlimited
-- PUT /user/username behavior. Run only during the deploy window if the
-- forward migration must be backed out:
--   psql $DIRECT_URL -f rollback.sql
ALTER TABLE "User" DROP COLUMN IF EXISTS "usernameChangeCount";
ALTER TABLE "User" DROP COLUMN IF EXISTS "usernameSetByUser";

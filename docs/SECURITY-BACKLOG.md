# Security Backlog — npm audit (45 as of 2026-09-09)

> CI gate (`tools/audit-gate.js`) fails ONLY on `critical` with a non-breaking
> fix available. Everything below is allowlisted (pass with warning) so CI stays
> green while the backlog is burned down. Do NOT reintroduce
> `npm audit --audit-level=high` (would go permanently red).

## Snapshot (2026-09-09 build-all re-check)

- `npm audit --json` metadata: **45 total = 28 moderate + 16 high + 1 critical**
- (Previous snapshot 2026-09-08: 42 total = 27 moderate + 14 high + 1 critical.
  Delta +3 is lockfile/count drift from earlier tracks' dep bumps, not new code.)
- `npm audit fix` (non-breaking) re-attempted 2026-09-09: timed out after 180s
  with **no changes applied** (before/after counts identical: 45 → 45, build
  still green — backend tsc 0, web tsc 0, vitest 201/201, vite dev-build 0).
  No `package-lock.json` churn committed by this lane (working-copy
  package.json/lock diffs predate it — earlier tracks' helmet/test-script bumps).
- Critical: `tar <=7.5.20` (GHSA-23hp-3jrh-7fpw Decompression DoS + 11 other
  tar advisories). `fixAvailable: expo@57.0.20, isSemVerMajor:true`.
  - Why allowlisted: fix requires **major** bump of `expo` (mobile toolchain),
    not a safe `npm audit fix`. Risk is build-time tar extraction (mobile
    prebuild/cacache), not runtime request path. Tracked for separate
    expo-major upgrade sprint.
  - Action: schedule `expo 57` upgrade + `npm audit fix` re-run; verify
    `apps/mobile` prebuild still works.
- High (14): transitive via `@expo/*`, `@react-navigation/*`, `body-parser`,
  `decode-uri-component`, etc. No direct prod API dep is high without a safe
  fix — re-check weekly via `node tools/audit-gate.js`.
- Moderate (27): same transitive set — burn down via `npm update` in a
  dedicated deps sprint, not mixed with prod P0 deploys.

## How to re-check

```bash
npm audit --json | python -c "import json,sys;d=json.load(sys.stdin);print(d['metadata']['vulnerabilities'])"
node tools/audit-gate.js
```

## Burn-down plan (breaking upgrades — separate PRs, never mixed with prod P0 deploys)

1. Expo-major upgrade (owns `tar` critical) — separate PR, mobile e2e.
   Plan: `npx expo install expo@57` in `apps/mobile`, `npm audit fix`, verify
   `apps/mobile` prebuild + web/backend builds + vitest green. Risk: build-time
   tar extraction (mobile prebuild/cacache), not runtime request path.
2. `react-router-dom 6.30.6 → 7.x` (major): codemod routes (`Routes/Route`
   API changes), re-run Playwright smoke 10 paths + `tsc` web.
3. `file-type 19.x → 22.x` (major, ESM-only): verify `uploadScan.ts` dynamic
   `import('file-type')` still resolves (`fileTypeFromBuffer` named export);
   keep `UPLOAD_SCAN_STRICT` fail-closed test green.
4. `exceljs 4.4.0` (downgrade-major available): pin, verify form/hackathon
   exports + CSV-formula prefix tests.
5. `prisma 6.x → 8.x` (`@prisma/config/deepmerge-ts`): regen client, `prisma
   validate`, `migrate deploy` on staging, run `RevokedToken/LoginAttempt`
   read-through green.
6. `npm update multer sharp qs body-parser express @prisma/config`
   (non-breaking, `fixAvailable:true`) in a deps-only PR with backend build +
   upload-scan + rate-limit smoke.
7. Re-enable stricter gate only after backlog <5 high+ (update this doc + `tools/audit-gate.js`).

## Rollback

- Gate rollback: `npm audit --audit-level=high` (will fail on 42 — expected).
- No runtime rollback needed (audit gate is CI-only, no prod code change).

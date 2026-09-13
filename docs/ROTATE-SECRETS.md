# Secrets Rotation Runbook — CampusFlow (DO NOT rotate live creds from chat)

> This agent did **not** rotate any live credentials. `packages/backend/.env`
> historically held Neon/JWT/CRON values on disk (see F09) — treat them as
> potentially exposed and rotate **yourself** in the Neon + Render dashboards
> following the steps below. Never paste live secrets into chat, issues, or PRs.

## Scope

| Secret | Where it lives | Blast radius if leaked |
|---|---|---|
| `DATABASE_URL` (Neon pooled, `-pooler`) | Render `campusflow-api` env, local `.env` (git-ignored) | Full DB read/write |
| `DIRECT_URL` (Neon direct, no pooler) | Render `campusflow-api` env, local `.env` | Migrations + full DB |
| `JWT_SECRET` | Render `campusflow-api` env, local `.env` | Forge any session |
| `CRON_SECRET` | Render `campusflow-api` + each `campusflow-cron-*` env | Trigger expensive jobs |
| `AI_ENCRYPTION_KEY` (>=32 chars) | Render `campusflow-api` env | Decrypt stored provider keys — rotation re-encrypts, see §4 |
| `CLOUDINARY_API_SECRET` | Render `campusflow-api` env | Upload/delete media |
| `GROQ_API_KEY` | Render `campusflow-api` env, provider table (encrypted) | AI billing |

## 0. Pre-rotation checklist

- [ ] Announce maintenance window (JWT rotation logs everyone out).
- [ ] Confirm you have Neon org admin + Render service admin.
- [ ] `git status` clean, no `.env` tracked: `git ls-files | grep -x '\.env'` must be empty; same for `packages/backend/.env`.
- [ ] Gitleaks clean: `gitleaks detect --source . --verbose` (CI runs it on every PR).
- [ ] Note current deploy id in Render (for rollback).

## 1. Neon database URLs (DATABASE_URL + DIRECT_URL)

1. Neon dashboard → project → **Roles** → reset password for the app role (or create a new role `campusflow_app` and grant).
2. **Connection strings**: copy the new **pooled** URL (must contain `-pooler`, `sslmode=require`, `pgbouncer=true`, `connection_limit=50`, `pool_timeout=30`, `channel_binding=prefer`, `connect_timeout=30`) → this is the new `DATABASE_URL`.
3. Copy the new **direct** URL (no `-pooler`, no `pgbouncer`, `sslmode=require`, `channel_binding=prefer`, `connect_timeout=30`) → new `DIRECT_URL`.
4. Render → `campusflow-api` → **Environment** → update `DATABASE_URL` + `DIRECT_URL` → **Save** (triggers redeploy; `preDeployCommand` runs `prisma migrate deploy` on `DIRECT_URL`).
5. Local: update `.env` (never commit) and verify: `npx prisma validate --schema=packages/backend/prisma/schema.prisma` + `curl -fsS localhost:4000/api/health` shows `"db":"ok"`.
6. Old password: revoke/delete the old Neon role password only **after** the Render deploy is healthy.
7. If the old string was ever committed: rewrite history (`git filter-repo --path packages/backend/.env --invert-paths`), force-push, and treat the old creds as burned.

## 2. JWT_SECRET (forces global logout)

1. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` (≥32 chars).
2. Render → `campusflow-api` → update `JWT_SECRET` → redeploy.
3. All sessions invalidate on next request (`jwt.verify` fails closed) — users log in again. No DB migration needed.
4. Rollback: previous value is unrecoverable after overwrite (Render keeps version history — restore from dashboard within retention).

## 3. CRON_SECRET (internal jobs — 6 places)

1. Generate a fresh token the same way as JWT (32+ bytes).
2. Update in **6 places** (they must match): `campusflow-api` + `campusflow-cron-contests` + `campusflow-cron-profile-sync` + `campusflow-cron-contest-reminders` + `campusflow-cron-opportunities` + `campusflow-cron-cleanup`. (`campusflow-keepalive` holds NO secret by design — public `GET /api/health` only. Older revisions of this file said "5 places / 4 crons" before the `contest-reminders` job existed; `render.yaml` is now source of truth.)
3. Redeploy crons (Render picks up env on next schedule; trigger one manually and expect `200`, then a `401` with a wrong secret, `503` when unset).
4. Verify: `curl -fsS -X POST $API_BASE_URL/internal/cron/cleanup -H "x-cron-secret: $CRON_SECRET"` → `200`.

## 4. AI_ENCRYPTION_KEY (≥32 chars — special care)

`AiProvider.apiKey` rows are AES-256-GCM ciphertexts of this key. Rotating the key **without re-encrypting** bricks stored providers.

1. Maintenance mode on (pause `/api/ai-manager` writes).
2. Decrypt all rows with the OLD key, encrypt with the NEW key via the local one-off
   script `packages/backend/scripts/reencrypt-ai-providers.mjs` (keys ONLY via
   `OLD_AI_ENCRYPTION_KEY` / `NEW_AI_ENCRYPTION_KEY` env, never commit either).
   Dry-run default (no writes): `node scripts/reencrypt-ai-providers.mjs` (from
   `packages/backend/`); commit with `--apply`. Full flags + exit codes: see the
   script header (`--dry-run` / `--only-id` / `--limit` / `--json` / `--selftest`).
3. Update Render `AI_ENCRYPTION_KEY` → redeploy.
4. Spot-check one provider decrypt + one `/api/ai` call, then maintenance off.

## 5. Cloudinary + Groq

- **Cloudinary**: dashboard → Settings → **Regenerate API secret** → update Render `CLOUDINARY_API_SECRET` → redeploy → upload one test file.
- **Groq**: console → revoke old key → create new → update Render `GROQ_API_KEY` (and any re-encrypted `AiProvider` rows) → redeploy.

## 6. Post-rotation verification

- [ ] `curl -fsS https://campusflow-api.onrender.com/api/health` → `status: ok, db: ok`.
- [ ] Login → refresh → one authenticated request (JWT path).
- [ ] One cron dry-run returns `200`.
- [ ] One Cloudinary upload + one AI call succeed.
- [ ] `npm audit --audit-level=high` + Gitleaks clean in CI on the rotation commit (commit contains **no** secret values, only this runbook / `render.yaml` `sync: false` placeholders).

## Rollback plan

- Render keeps prior env values in deploy history — restore the previous deploy for JWT/CRON/Cloudinary/Groq (DB URLs: keep the new Neon password; rolling back the env without restoring the Neon password breaks connectivity — prefer fix-forward).
- Expected rollback time: <5 min (Render redeploy). Notify: on-call + `#campusflow-ops`. Re-run §6 after rollback.

---

## Track-1 Appendix (2026-09-08 backend-security hardening)

### What was sanitized by the agent (no live values committed)

- `test-opencode/test-opencode.js:5` — removed hardcoded `gsk_` live key → `process.env.GROQ_API_KEY` fail-closed + redacted log. Old key must be revoked in Groq console (owner).
- `QuizSolver/.env:1` — removed live `gsk_` → placeholder `***REMOVED***`. Already gitignored, but value was live on disk.
- `packages/backend/.env` — replaced dictionary `JWT_SECRET` / `AI_ENCRYPTION_KEY` / `CRON_SECRET=any-random-string` + commented `gsk_` / `sk-` + live Neon owner URLs with local-only `.env` (local postgres + 64-hex `openssl rand -hex 32` secrets). Old Neon passwords must be reset (3 endpoints seen in `.bak` files).
- Deleted `*.bak` secrets sprawl: `.env.ohio.bak`, `.env.ohio.bak2`, `.env.sg18-pre.bak`, `neon_dump.bak`, `neon_dump_18.bak`, `sg18_dump.bak` (224KB dumps contain row PII). `*.log` dumps remain on disk (gitignored) — owner must delete if they contain PII/URLs.
- `docker-compose.yml:32-33` — `CRON_SECRET` / `AI_ENCRYPTION_KEY` now `${VAR:?required}` fail-closed (was weak `:-dev-*` defaults). `JWT_SECRET` already fail-closed.
- `src/utils/encryption.ts:12` — ASCII-slice KDF → HKDF-SHA256 (`hkdfSync`, salt `campusflow-ai-v1-salt`, info `campusflow-ai-v1`, 32B). New rows prefixed `v1:`; legacy rows decrypt-only for migration. Re-encrypt per §4 then remove legacy path.
- `prisma/seed.ts:66` — `password123` (bcrypt10) → `SEED_ADMIN_PASSWORD` or per-run random (bcrypt12, log-once dev-only). Prod skips demo data unless `SEED_DEMO_USERS=true`.
- `src/routes/auth.ts` + `src/middleware/auth.ts` — register generic failure (no `Email already registered` enumeration) + per-email lockout on register + HttpOnly `campusflow_token` cookie issued on login/register (dual-issuance step 1, Bearer still accepted — no frontend break). Logout clears cookie + revokes jti. bcrypt12 + jti revoke kept.
- `src/index.ts` + `src/config/index.ts` — helmet COOP/CORP `same-origin`, CORS fail-closed in prod (no localhost fallback), JSON `10mb→1mb` + auth `100kb` 413 guard, `JWT_EXPIRES_IN` default `7d→1d` until HttpOnly refresh lands, weak-secret boot asserts for JWT/AI/CRON.
- `src/services/resumePdf.ts:43-111` — removed `pdflatex` spawn (RCE) + dynamic-code eval + `latexonline.cc` PII exfil. Pure `pdfkit` vector only. `.tex` download remains for Overleaf client-side compile.

### Owner rotation checklist (do this now — agent did NOT touch live dashboards)

- [ ] Groq: console → revoke old `gsk_` (the one that was in `test-opencode.js` / `QuizSolver/.env` / `backend/.env:4` comment) → create 2 keys (local + Render `GROQ_API_KEY`) → update Render `campusflow-api` env → redeploy → test one `/api/ai` call.
- [ ] Neon: dashboard → reset password for all 3 endpoints seen in `.bak` files (young-bread / wispy-haze / patient-smoke) OR delete old roles → create least-privilege `campusflow_app` (not `neondb_owner`) → build new pooled (`-pooler` + `pgbouncer=true&connection_limit=50`) + direct URLs → update Render `DATABASE_URL` + `DIRECT_URL` → redeploy → verify `/api/health {"db":"ok"}`.
- [ ] JWT / CRON / AI keys: `openssl rand -hex 32` each → update Render (`campusflow-api` + 5 cron services for CRON must match — `contests`, `profile-sync`, `contest-reminders`, `opportunities`, `cleanup`; this 2026-09-08 line once said "4" before `contest-reminders` existed) → redeploy → verify login + `POST /internal/cron/cleanup` 200 with right secret / 401 with wrong.
- [ ] AI re-encrypt (§4): maintenance on → decrypt `AiProvider` rows with OLD key, encrypt with NEW (one-off script, both keys in env, never commit) → update Render `AI_ENCRYPTION_KEY` → spot-check decrypt + `/api/ai` → maintenance off. New rows are `v1:` HKDF.
- [ ] Purge history (if secrets were ever pushed):
  ```bash
  # inside CampusFlow/ (git root)
  git status --porcelain | head
  git ls-files | grep -E '\.env$|\.bak|dump\.bak|test-opencode' || echo "no tracked secrets"
  gitleaks detect --source . --verbose
  # if history contains secrets:
  git filter-repo --strip-blobs-bigger-than 50K --replace-text <(echo 'gsk_[A-Za-z0-9]+==>***REMOVED***') --force
  # or BFG: bfg --delete-files '*dump*.bak' --delete-files '.env*' --replace-text passwords.txt
  git push --force --all && git push --force --tags
  # treat old keys as burned even after purge (rotate first, purge second)
  ```
- [ ] Verify: `gitleaks detect --source . --verbose` clean + `git ls-files | grep -E '\.bak$|\.env$|dump\.bak'` empty + `grep -R --exclude-dir=node_modules --exclude-dir=dist -E 'gsk_|password123' .` shows only placeholders/`***REMOVED***` (redacted output).
- [ ] Delete local `*.log` dumps (`neon_dump*.log`, `sg18_*.log`) if they contain URLs/PII; empty Recycle Bin; rotate any Cloudinary/Zen `sk-` keys seen in comments.

### Coordination notes for Track-2/3 (do not break frontend)

- Register now returns generic `Registration failed. If this email is already registered, please log in.` (was `Email already registered`). Frontend `RegisterPage.tsx` must map this to field error + link to `/login` (Track-2).
- Login/register now also `Set-Cookie: campusflow_token=...; HttpOnly; SameSite=Lax; Secure(prod)`. Frontend keeps Bearer (no change required); migration to memory-only + HttpOnly refresh per `AUTH-HTTPONLY-PLAN.md` is Track-2.
- `JWT_EXPIRES_IN` default is now `1d` (was `7d`). Mobile `SecureStore` + web `localStorage` sessions expire sooner until refresh lands — announce in release notes.
- Resume `?format=pdf` now always `X-Pdf-Engine: pdfkit-vector` (never `local-pdflatex`/`online-latex`). Remove any UI copy promising “Overleaf fidelity server-side”; keep `.tex` → Overleaf paste flow.
- `AsIsResumePreview.tsx:589` `dangerouslySetInnerHTML` + Excel `'=+-@` prefixing are Track-2 (frontend out of Track-1 scope) — backend `escapeExcelValue` + `safeFilename` + `contentDisposition` already enforce; verify exports call them.
- `QuizSolver/.env` placeholder only — Track-3 owns `config.py` validation + `gui.py` quoting + Tesseract env.

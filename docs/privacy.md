# Privacy — CampusFlow

> Status: harness doc (P0 gap closure start). Covers PII inventory, retention, erasure plan, and export audit. See `COMPLETE-COMPENDIUM.md` W1/W7 + Privacy §10.

## 1. PII Inventory

| Model / Source | Fields (PII) | Exposed Where | Current Protection |
|---|---|---|---|
| `User` | `name`, `email`, `passwordHash` (bcrypt), `studentId`, `empNumber`, `departmentId/Name`, `collegeId/Name`, `year` in/out, `avatar`, `portfolioUrl`, `preferences` | `GET /api/u/:username` (public), `GET /api/user/profile` (authed), admin lists | **FIXED 2026-09-09 (was GAP F05/W7):** anon `GET /api/u/:username` returns masked email (`j***@…`, `maskEmail` in `utils/roles.ts`) + no `studentId`/`empNumber`, `X-Robots-Tag: noindex`, `60/h` per-IP limiter (`routes/publicProfile.ts`). Keep minimal per §4. |
| `CodingProfile` | handles (`leetcode/codeforces/codechef/hackerrank/gfg/githubUsername`), `platformStats` | Public profile embed | Handles are user-published; no email inside |
| `Grade` / `GradeData` / `AttendanceData` | per-student subjects JSON, handles | `/api/grades`, `/api/attendance` (authed, tenant-scoped) | Auth + `canAccessCollege`; no public route |
| `FormResponse.answers` | free-text answers (unbounded today) | Form owner export (Excel) | Auth + creator/college gate; **GAP:** no max length, no DLP scan (F28) |
| `RoomMessage` + uploads | message text, file URLs (`/uploads` or Cloudinary) | Room members only | `RoomMember` gate; forced-download for active types |
| `HackathonRegistration` / `InternshipRegistration` | `userId` link + status/round | Detail + export endpoints | **GAP (F01/F02):** detail + Excel export lack tenant gate |
| Logs (`pino`) | `requestId`, route, status — **must never include** `email`, `password`, `token`, `answers` | Server logs | `logger.ts` redacts `password/token/authorization/cookie/email` keys |
| Excel exports (forms/hackathons/internships) | `name`, `email`, `studentId`, answers | Downloaded `.xlsx` (lingers on downloader disk) | **GAP:** no watermark/audit; fix per §5 |

Rules:
- Never log PII. `logger.warn/error` take `{ requestId, route, code }` only.
- Never return `passwordHash`. Select explicitly on every `User` query.
- Public profile (`publicProfile.ts`) is the **only** unauth PII surface — keep it minimal (see §4).

## 2. Retention

| Data | Retention | Job / Owner |
|---|---|---|
| `HackathonStaging` / `InternshipStaging` `REJECTED` | 30 days, then hard delete | Weekly cron `runCleanupJob` (`/internal/cron/cleanup`) |
| `FormResponse` | Until form deleted or erasure request | Manual + erasure flow |
| `RoomMessage` / uploads | Until room deleted or erasure request | Manual + erasure flow |
| `Notification` / `ChatMessage` | 90 days rolling (planned; not yet enforced) | TODO: cron + `take:50` pagination |
| Server logs (pino JSON) | 30 days (stdout → platform logs) | Render/host retention |
| Export audit rows | 1 year (append-only, no PII payload) | TODO: `ExportAudit` model |
| Excel files on client disks | Cannot retract — mitigate via watermark + audit (§5) | Policy + UI notice |

## 3. Erasure — `DELETE /user/me` (implemented 2026-09-10, #12)

Implemented in `packages/backend/src/routes/user.ts` (`DELETE /me`, pure
helpers in `packages/backend/src/services/selfDelete.ts`, tests in
`packages/backend/tests/self-delete.test.ts`). Contract matches the plan
below; Settings danger-zone UI (password + type-DELETE double confirm) calls
`userAPI.deleteMe(password)`.

Planned contract (to be added to `packages/backend/src/routes/user.ts`):

```yaml
DELETE /api/user/me:
  auth: Bearer JWT (self only; no admin-on-behalf in v1)
  behavior:
    - 1. Verify identity: require current password re-entry (body.password) to prevent token-replay abuse
    - 2. Anonymize User row: name -> "Deleted User", email -> "deleted_<uuid>@deleted.local", studentId/empNumber/avatar/portfolioUrl/preferences -> NULL, passwordHash -> random 32B hex, role -> STUDENT, collegeId -> NULL
    - 3. Keep FK rows (regs/submissions/responses) but detached from PII (userId retained for integrity, PII gone)
    - 4. Delete CodingProfile.handles + UserIntegration secrets for that userId
    - 5. Return 200 { deleted: true, anonymizedEmail } + audit log (no PII payload)
    - 6. Rate limit: 3/h per user (reuse authLimiter pattern)
  tests (P0, add next): self-delete anonymizes + second delete 404 + other-user data untouched
```

Why anonymize-not-delete: FK graph (`AssignmentSubmission`, `FormResponse`, `HackathonRegistration`, …) has no `onDelete: Cascade`; hard delete would orphan or 500. Anonymize preserves integrity while erasing PII. Hard-delete option requires migration adding cascades — track as follow-up.

## 4. Public Email Mask (P0 fix spec + test)

File: `packages/backend/src/routes/publicProfile.ts:231-247`.

```ts
// helper (tested in tests/p0-parity.test.ts — no DB needed)
export function maskEmailForPublic(email: string | null | undefined, isAuthed: boolean): string | null {
  if (!email) return null;
  if (isAuthed) return email; // authed viewers hit /private path with college check (planned)
  const [local, domain] = String(email).split("@");
  if (!domain) return "*****";
  const head = local.slice(0, 1) || "*";
  return `${head}***@${domain}`; // j***@college.edu
}
```

- Anon `GET /api/u/:username` → `user.email` masked (`j***@…`), no `studentId`/`empNumber`.
- Authed `GET /api/u/:username/private` (planned) → full email only if `canAccessCollege(viewer, user.collegeId)` else 403.
- `robots.txt` + meta `noindex` on `/u/*` until mask + limiter land (see `docs/seo.md`).
- Rate limit public profile 60/h per IP (planned; mirrors college-register pattern).

## 5. Export Audit (plan)

Every bulk export (`hackathons.ts:1096`, `forms.ts` export, `internships.ts` export) must:

1. Gate: `authenticate` + `canAccessCollege(user, resource.collegeId)` + role (`TEACHER`/`COLLEGE_ADMIN`/`SUPER_ADMIN`).
2. Sanitize filename via `safeFilename()` (strip `[\r\n"]`, `filename*` UTF-8) — tested P0.
3. Prefix CSV-formula cells (`=`, `+`, `-`, `@`) with `'` (F27).
4. Write audit row: `{ at, actorId, collegeId, resource, count, requestId }` — no row PII.
5. Set `Content-Disposition: attachment; filename*=UTF-8''<safe>` + `Cache-Control: private, max-age=0`.

Until `ExportAudit` model exists, log via `logger.info({ event: "export", actorId, collegeId, resource, count, requestId })`.

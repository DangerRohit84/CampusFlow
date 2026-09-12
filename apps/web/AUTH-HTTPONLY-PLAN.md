# Auth Token Storage — HttpOnly Migration Plan

> Status: **NOT MIGRATED** — JWT stays in `localStorage` (`campusflow-auth` via zustand/persist)
> for now. This doc is the approved path to HttpOnly cookies (audit F16 / F21 follow-up).

## Why localStorage is tolerated today

- API is stateless JWT (`Authorization: Bearer`) consumed by web + mobile from one backend.
- No SSR — no server component can hold the token for us.
- XSS impact is contained by DOMPurify sanitization + strict CSP work (see F25).

## Why we must migrate

Any persisted XSS can exfiltrate `localStorage` tokens (long-lived). HttpOnly cookies
remove the token from JS reach entirely and enable SameSite CSRF defense.

## Migration steps

1. **Backend — dual issuance** (`packages/backend/src/routes/auth.ts`)
   - `POST /api/auth/login|register` keeps returning `{ user, token }` AND sets
     `Set-Cookie: cf_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7d`.
   - Add `POST /api/auth/refresh` (rotating refresh cookie `cf_refresh`, 30d, `SameSite=Strict`, `/api/auth/refresh` path).
   - Auth middleware accepts `Authorization` header OR `cf_session` cookie (header wins during transition).
2. **Backend — logout**: `POST /api/auth/logout` clears both cookies.
3. **CORS**: `credentials: true` + explicit frontend origin allowlist (no `*`).
   Axios: `withCredentials: true`; socket.io: `withCredentials: true`.
4. **CSRF**: SameSite=Lax covers top-level GET; add double-submit `cf_csrf` token
   (non-HttpOnly, echoed in `X-CSRF-Token`) for POST/PUT/PATCH/DELETE.
5. **Frontend** (`apps/web/src/store/authStore.ts`, `lib/api.ts`, `lib/socket.ts`)
   - Stop persisting `token` in zustand; keep `{ user }` only.
   - Interceptor drops manual `Authorization` header; relies on cookies.
   - Socket `auth: {}` via cookie handshake (no token in `io()` options).
6. **Mobile** (`apps/mobile`): keep `expo-secure-store` (already correct) — call
   refresh endpoint, no cookie jar needed.
7. **Rollout**: dual-accept 1 release → force cookie-only → delete header path +
   remove this TODO. Add e2e: stolen-XSS sim cannot read token; CSRF POST without
   token header → 403; logout clears cookies.

## Interim hardening (done / do now)

- Short JWT TTL (≤24h) + refresh rotation.
- `VITE_API_URL` allowlist — never send token cross-origin except API host.
- Keep `logout()` clearing `campusflow-auth` + cookies (defense in depth).

## TODO(auth, P1)

Migrate session storage from `localStorage` to HttpOnly cookies per this plan.
Tracking: F16. Owner: auth team. Until then, do NOT store additional secrets
(Groq keys, etc.) alongside the token without user consent + expiry.

# SEO Index Map — CampusFlow

> Status: harness doc. Baseline SEO 3.2/10 FAIL (single title, no meta/OG/canonical/robots/sitemap, W4). This map defines index/noindex + the 10-path Playwright smoke list.

## Current State (`apps/web/index.html:1-38`)

- Single `<title>CampusFlow — Campus OS</title>`, no `meta description`, no OG/Twitter, no canonical, no JSON-LD, no `react-helmet` per-route.
- `public/` has no `robots.txt` / `sitemap.xml`.
- `nginx.conf:15-17` SPA fallback OK, no prerender.

## Target (incremental, no framework swap)

1. Per-route head via `react-helmet-async`: unique `<title>` + `meta[name=description]` + `link[rel=canonical]` + OG (`og:title/description/image`) + Twitter card on public routes (`/`, `/login`, `/register`, `/college-registration`, `/hackathons`, `/internships`, `/contests`).
2. `lang="en"` (already set) + one `<h1>` per page + semantic headings.
3. `robots.txt`: allow public, disallow authed + `/u/*` (until W7 mask lands), disallow `/api/*`, `/admin/*`, `/fetch`.
4. `sitemap.xml`: public routes only — no PII URLs, no `/u/:username`.
5. `noindex, nofollow` meta on: `/u/*`, `/chat`, `/settings`, `/admin/*`, 404/403/500.
6. OG image: single static `/og-cover.png` (1200×630) until per-route images exist.
7. JSON-LD `Organization` on `/` only.

## Index Map

| Path | Index? | Notes |
|---|---|---|
| `/` (canonical; `/landing` 301→`/` alias, not indexed separately) | ✅ index | Landing + Organization JSON-LD + canonical self. SPA `/landing` redirects via `Navigate` + nginx 301; `Seo.tsx` canonicalizes `/landing` to `/`. |
| `/login`, `/register`, `/register-college` (`/college-registration` is legacy alias for `/register-college`) | ✅ index | Canonical self; no PII in meta. `/register` = self-signup, `/register-college` = college intake (separate forms, separate meta). |
| `/hackathons`, `/internships`, `/contests` | ❌ `noindex` until gated | Tenant lists stay `noindex` + robots disallow until F01–F04 tenant gates land (then flip to index per-row). `Seo.tsx` `PUBLIC_EXACT` excludes them today — code and map agree. |
| `/hackathons/:id`, `/internships/:id` | ❌ `noindex` until gated | Detail; OG title = opportunity title; block until F01–F04 tenant gates land or keep `noindex` |
| `/leaderboard` (`/contests/leaderboard`) | ❌ `noindex` until anti-gaming lands | Aggregate only, no emails — but `Seo.tsx` forces `noindex` (not in `PUBLIC_EXACT`) + `robots.txt` disallows `/contests/leaderboard` today. Flip to index only with anti-gaming note. |
| `/u/:username` | ❌ `noindex, nofollow` | Public PII surface; robots disallow until email mask + 60/h limiter (W7) |
| `/chat`, `/rooms/*`, `/assigned`, `/forms/*`, `/settings`, `/admin/*`, `/fetch`, `/insights` | ❌ `noindex` + robots disallow | Authed app surfaces |
| `/404`, `/403`, `/500` | ❌ `noindex` | Error pages (to be added, W3) |

## `public/robots.txt` (actual — keep in sync with `Seo.tsx` PUBLIC_EXACT + `sitemap.xml`)

```txt
User-agent: *
Allow: /
# /landing 301s to / — no separate Allow (alias, canonical /).
Allow: /login
Allow: /register
Allow: /register-college
Allow: /privacy
Allow: /terms
Allow: /about
Allow: /help
Allow: /contact
Disallow: /dashboard
Disallow: /admin
Disallow: /superadmin
Disallow: /api/
Disallow: /u/
# Authed/app surfaces stay noindex + disallow (tenant privacy until gated).
Disallow: /chat
Disallow: /rooms/
Disallow: /settings
Disallow: /fetch
Disallow: /insights
Disallow: /forms
Disallow: /contests/leaderboard
Sitemap: https://campusflow.dev/sitemap.xml
```

> Tenant lists (`/hackathons`, `/internships`, `/contests`) are allowed by `Allow: /` at crawl level but carry `noindex` meta via `Seo.tsx` (not in `PUBLIC_EXACT`) — they stay out of the index until F01–F04 gates land. `/u/` is both disallowed and `noindex`. Canonical host comes from `VITE_SITE_URL` at deploy (see `Seo.tsx` + `index.html` + sitemap note below); `https://campusflow.dev` is the fallback placeholder.

## Canonical SSOT — Vercel + Render deploy note (2026-09-13 Track C)

- **Single source:** `VITE_SITE_URL` (Vercel env: Production + Preview; e.g. `https://campusflow.vercel.app` or custom domain after DNS).
- **Fallback:** `https://campusflow.dev` in `apps/web/index.html` canonical/OG, `Seo.tsx` fallback, `public/sitemap.xml` locs, `public/robots.txt` Sitemap, `public/.well-known/security.txt` Canonical/Policy — placeholder only, never ship unset in prod.
- **Build-time replace:** at build/deploy, replace the `campusflow.dev` fallback host in `index.html` + `sitemap.xml` + `robots.txt` Sitemap + `security.txt` Canonical with the SAME `VITE_SITE_URL` host (e.g. `sed -i 's#https://campusflow.dev#https://<vercel-host>#g'` on those four files pre-build, or Vercel buildCommand hook). Static files cannot read `import.meta.env` at serve time.
- **Verify post-build:** `dist/index.html` canonical == `Seo.tsx` canonical == sitemap locs == robots Sitemap (grep `campusflow.dev` in `dist/` must be empty when a real host is set; `grep -R "campusflow-web.onrender.com\|vercel.app" dist/index.html` shows the live host).
- **Vercel wiring:** `vercel.json` (root) owns SPA rewrites (`/(.*) → /index.html`), `Cache-Control: /assets/* immutable`, and security headers mirroring `render.yaml`/`nginx.conf` (same CSP hash + connect-src API/wss/Cloudinary). `VITE_API_URL` + `VITE_SITE_URL` are set in the Vercel Dashboard (Production + Preview, rebuild on change — Vite bakes at build time). `trailingSlash: false` avoids duplicate index entries (`/landing` alias canonicalizes to `/` in `Seo.tsx`).
- **Backend origins:** `FRONTEND_URL` (+ optional `FRONTEND_URLS` csv) allowlists the Vercel origin alongside onrender during dual-serve (comma-separated, never `*` in prod) for CORS + Socket.IO (`config.frontendUrls` SSOT). `VITE_GROQ_API_KEY` must NEVER be set in Vercel (client-bundle leak — backend proxy only).

## CSR + prerender note (no framework swap)

- SPA is CSR (Vite, no SSR). `index.html` carries fallback title/description/canonical/OG (`og-cover.png` 1200×630) + Twitter for bots without JS.
- `Seo.tsx` (`RouteSeo` + `PUBLIC_EXACT` 10 paths: `/`, `/landing` alias, `/login`, `/register`, `/register-college`, `/privacy`, `/terms`, `/about`, `/help`, `/contact`) refines per-route on render.
- Sharing tags validated: `og:title/description/image/secure_url/type/alt/width/height`, `twitter:card/title/description/image/alt`, `canonical`, `robots`.
- Optional prerender: `react-snap` / `vite-plugin-prerender` snapshots of the 10 public paths for bot parity; users still get SPA fallback + `/landing`→`/` redirect.

## Playwright Smoke List (10 paths — `apps/web/e2e/smoke.spec.ts` plan)

1. `/` — landing renders, `<h1>` present, title `CampusFlow — Campus OS`
2. `/login` — form labels present, submit 401 on bad creds (no enum leak beyond generic)
3. `/register` — college dropdown loads from `GET /api/colleges/list`
4. `/hackathons` — list renders (mocked API), pagination controls present
5. `/hackathons/:id` — detail renders; anon sees masked email only (P0 test mirrors API)
6. `/internships` — list renders
7. `/contests` — list renders
8. `/leaderboard` — renders without PII emails
9. `/u/:username` — renders with `noindex` meta + masked email for anon
10. `/404` (unknown route) — 404 page renders with home link (after W3 lands; today asserts SPA fallback does not crash)

Each spec: `expect(page).toHaveTitle(/CampusFlow/)`, no console errors, `X-Request-Id` response header present on API calls.

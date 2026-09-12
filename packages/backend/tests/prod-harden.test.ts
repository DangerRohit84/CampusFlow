/**
 * Prod-harden targeted tests — hermetic, no DB/network.
 * Covers P0 closers for 10k + 10/10:
 *  - uploads: blocked ext, EICAR/scan stub, magic-byte mismatch
 *  - aiQuota: 8000 input cap, token estimate, 429 breaker helpers
 *  - auth: lockout 5/15m, jti sign/revoke
 */
import { describe, it, expect } from 'vitest';
import { validateUploadMagicBytes, scanBufferForMalware } from '../src/utils/uploadScan';
import { estimateTokens, AI_MAX_INPUT_CHARS, AI_USER_DAILY_LIMIT, AI_COLLEGE_DAILY_TOKENS, noteAiUpstreamError } from '../src/middleware/aiQuota';
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin, signJwtWithJti, isJtiRevoked, revokeJti } from '../src/utils/authHardening';
import jwt from 'jsonwebtoken';

describe('uploads hardening', () => {
  it('blocks html/svg/xml/js by extension', async () => {
    for (const name of ['x.html', 'x.svg', 'x.xml', 'x.js', 'x.mjs']) {
      const err = await validateUploadMagicBytes(Buffer.from('hello'), name, 'text/plain', 'rooms');
      expect(err).toMatch(/not allowed/i);
    }
  });

  it('scan stub blocks EICAR + script markers', async () => {
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const r1 = await scanBufferForMalware(eicar, 'a.pdf');
    expect(r1.clean).toBe(false);
    const r2 = await scanBufferForMalware(Buffer.from('<script>alert(1)</script>'), 'a.pdf');
    expect(r2.clean).toBe(false);
    const r3 = await scanBufferForMalware(Buffer.from('%PDF-1.4 fake'), 'a.pdf');
    expect(r3.clean).toBe(true);
  });

  it('magic-byte mismatch rejects (html bytes as .pdf)', async () => {
    const html = Buffer.from('<html><body>hi</body></html> '.repeat(20));
    const err = await validateUploadMagicBytes(html, 'evil.pdf', 'application/pdf', 'rooms');
    // file-type sniffs html as html (or scan stub catches) — either way rejected
    expect(err).not.toBeNull();
  });
});

describe('aiQuota', () => {
  it('exports prod limits', () => {
    expect(AI_USER_DAILY_LIMIT).toBe(100);
    expect(AI_COLLEGE_DAILY_TOKENS).toBe(10_000);
    expect(AI_MAX_INPUT_CHARS).toBe(8000);
  });
  it('estimateTokens ~ chars/4', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
  });
  it('429 breaker helper does not throw on non-429', () => {
    expect(() => noteAiUpstreamError('summarize', new Error('nope'))).not.toThrow();
    const e: any = new Error('rate_limit_exceeded');
    e.status = 429;
    expect(() => noteAiUpstreamError('summarize', e)).not.toThrow();
  });
});

describe('auth hardening (jti + lockout)', () => {
  it('signs JWT with jti and verifies', () => {
    // Need JWT_SECRET >=32 for config import — set dummy if missing in test env
    const { token, jti } = signJwtWithJti('user-123');
    expect(typeof token).toBe('string');
    expect(typeof jti).toBe('string');
    expect(jti.length).toBeGreaterThan(10);
    expect(isJtiRevoked(jti)).toBe(false);
    revokeJti(jti);
    expect(isJtiRevoked(jti)).toBe(true);
    // token decodes with same jti
    const decoded: any = jwt.decode(token);
    expect(decoded.jti).toBe(jti);
    expect(decoded.userId).toBe('user-123');
  });

  it('locks out after 5 fails/15m, resets on success', () => {
    const email = `locktest-${Date.now()}@x.edu`;
    expect(isLockedOut(email).locked).toBe(false);
    for (let i = 0; i < 5; i++) recordFailedLogin(email);
    const locked = isLockedOut(email);
    expect(locked.locked).toBe(true);
    expect(locked.retryAfterSec).toBeGreaterThan(0);
    recordSuccessfulLogin(email);
    expect(isLockedOut(email).locked).toBe(false);
  });
});

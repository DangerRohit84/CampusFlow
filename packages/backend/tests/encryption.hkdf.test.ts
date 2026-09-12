/**
 * Track-1: AI_ENCRYPTION_KEY HKDF contract (hermetic, no DB).
 * Locks: HKDF-SHA256 32B derive, v1: prefix on new rows, legacy decrypt-only,
 * weak/placeholder boot failure.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const TEST_HEX_64 = 'ab'.repeat(32); // 64 hex, 256-bit deterministic for tests
const OTHER_HEX_64 = 'cd'.repeat(32);

describe('encryption HKDF (v1)', () => {
  beforeEach(() => {
    process.env.AI_ENCRYPTION_KEY = TEST_HEX_64;
  });

  it('encrypt round-trips with v1: prefix', async () => {
    const { encryptApiKey, decryptApiKey } = await import('../src/utils/encryption');
    const ct = encryptApiKey('***REMOVED***');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(decryptApiKey(ct)).toBe('***REMOVED***');
  });

  it('different IVs per encrypt (randomized)', async () => {
    const { encryptApiKey } = await import('../src/utils/encryption');
    const a = encryptApiKey('same-plain');
    const b = encryptApiKey('same-plain');
    expect(a).not.toBe(b);
  });

  it('legacy (no-prefix) ciphertext still decrypts with same env (migration)', async () => {
    // Build a legacy-format row using the old slice-KDF directly (test-only).
    const crypto = await import('crypto');
    const legacyKey = Buffer.from(TEST_HEX_64.slice(0, 32), 'utf-8');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey, iv);
    const enc = Buffer.concat([cipher.update('legacy-plain', 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacyCt = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
    const { decryptApiKey } = await import('../src/utils/encryption');
    expect(decryptApiKey(legacyCt)).toBe('legacy-plain');
  });

  it('weak/placeholder keys throw on encrypt (fail-closed)', async () => {
    const { encryptApiKey } = await import('../src/utils/encryption');
    for (const weak of [
      '',
      'short',
      'campusflow-ai-encryption-key-2026-secure',
      'REPLACE_ME_generate_with_openssl_rand_hex_32_AI_KEY_64ch',
      'dev-encryption-key-32-chars-minimum',
    ]) {
      process.env.AI_ENCRYPTION_KEY = weak;
      expect(() => encryptApiKey('x')).toThrow();
    }
    process.env.AI_ENCRYPTION_KEY = TEST_HEX_64;
  });

  it('wrong key does not decrypt (auth tag fails)', async () => {
    const mod = await import('../src/utils/encryption');
    const ct = mod.encryptApiKey('secret-abc');
    process.env.AI_ENCRYPTION_KEY = OTHER_HEX_64;
    expect(() => mod.decryptApiKey(ct)).toThrow();
    process.env.AI_ENCRYPTION_KEY = TEST_HEX_64;
  });
});

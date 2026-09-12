/**
 * Prod incident regression (2026-09-09, same class as lastSyncError):
 * live DB never got a RevokedToken migration, so `prisma.revokedToken.create()`
 * threw P2021 ("table public.RevokedToken does not exist") on login/socket
 * revoke paths and broke auth instead of degrading.
 *
 * Contract under test (mirrors saveSyncResult lesson):
 * - isMissingRevocationTableError() flags P2021/P2022/Unknown-argument/
 *   does-not-exist for RevokedToken/LoginAttempt; ignores real errors.
 * - persistRevocationAttempt() NEVER throws — pre-migration (or stale client)
 *   degrades to warn-once with the in-memory Set authoritative.
 * - revokeJti() adds to memory even when the DB write fails, and never throws
 *   (logout/refresh/change-password continue; login still succeeds).
 * - isJtiRevokedWithDb() fails open to memory (false) on missing table,
 *   memoizes DB hits, never throws.
 *
 * Hermetic: DB mocked (no network, no live writes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockFindUnique = vi.fn();

vi.mock('../src/config/db', () => ({
  __esModule: true,
  default: {
    get revokedToken() {
      return { create: mockCreate, findUnique: mockFindUnique };
    },
  },
}));

import {
  isMissingRevocationTableError,
  persistRevocationAttempt,
  revokeJti,
  isJtiRevoked,
  isJtiRevokedWithDb,
  signJwtWithJti,
  __resetRevocationWarnForTests,
} from '../src/utils/authHardening';

function p2021(): any {
  return Object.assign(
    new Error('The table `public.RevokedToken` does not exist in the current database.'),
    { code: 'P2021' }
  );
}

function unknownArg(): any {
  const e: any = new Error(
    'Unknown argument `revokedToken`. Available options are marked with ?.'
  );
  e.name = 'PrismaClientValidationError';
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRevocationWarnForTests();
  mockCreate.mockResolvedValue({ jti: 'ok' });
  mockFindUnique.mockResolvedValue(null);
});

describe('isMissingRevocationTableError detector', () => {
  it('flags pre-migration errors (P2021/P2022/Unknown-argument/relation-missing)', () => {
    expect(isMissingRevocationTableError({ code: 'P2021', message: 'x' })).toBe(true);
    expect(isMissingRevocationTableError({ code: 'P2022', message: 'x' })).toBe(true);
    expect(isMissingRevocationTableError(unknownArg())).toBe(true);
    expect(
      isMissingRevocationTableError(new Error('relation "RevokedToken" does not exist'))
    ).toBe(true);
    expect(
      isMissingRevocationTableError(
        new Error('Invalid prisma.revokedToken.create() invocation: table public.RevokedToken does not exist')
      )
    ).toBe(true);
  });

  it('ignores real errors (P2025/P1001/generic/null)', () => {
    expect(isMissingRevocationTableError({ code: 'P2025', message: 'not found' })).toBe(false);
    expect(isMissingRevocationTableError({ code: 'P1001', message: 'unreachable' })).toBe(false);
    expect(isMissingRevocationTableError(new Error('boom'))).toBe(false);
    expect(isMissingRevocationTableError(null)).toBe(false);
    expect(isMissingRevocationTableError(undefined)).toBe(false);
  });
});

describe('persistRevocationAttempt best-effort', () => {
  it('resolves (never throws) when the table is missing (P2021)', async () => {
    mockCreate.mockRejectedValueOnce(p2021());
    await expect(persistRevocationAttempt('jti-missing-1')).resolves.toBeUndefined();
  });

  it('resolves when the client is stale (delegate missing)', async () => {
    await expect(
      persistRevocationAttempt('jti-stale-1', {} as any)
    ).resolves.toBeUndefined();
    await expect(
      persistRevocationAttempt('jti-stale-2', { revokedToken: {} } as any)
    ).resolves.toBeUndefined();
  });

  it('resolves on transient (non-migration) failures too — revocation never breaks auth', async () => {
    mockCreate.mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'P1001' }));
    await expect(persistRevocationAttempt('jti-transient-1')).resolves.toBeUndefined();
  });

  it('writes jti/userId/expiresAt on the happy path', async () => {
    mockCreate.mockResolvedValueOnce({ jti: 'jti-ok-1' });
    await persistRevocationAttempt('jti-ok-1');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0][0];
    expect(args.data.jti).toBe('jti-ok-1');
    // Order-1 FK: RevokedToken.userId → User(id) nullable — NULL when no user context
    // ('unknown' would violate the FK). Callers with a user pass it explicitly.
    expect(args.data.userId).toBeNull();
    expect(args.data.expiresAt).toBeInstanceOf(Date);
  });

  it('passes through an explicit userId when the caller has auth context', async () => {
    mockCreate.mockResolvedValueOnce({ jti: 'jti-ok-2' });
    await persistRevocationAttempt('jti-ok-2', undefined, 'user-1');
    const args = mockCreate.mock.calls[0][0];
    expect(args.data.userId).toBe('user-1');
  });
});

describe('revokeJti degrades gracefully (login still succeeds)', () => {
  it('adds to memory + never throws when the DB table is missing', async () => {
    mockCreate.mockRejectedValue(p2021());
    const { jti } = signJwtWithJti('user-login-1');
    expect(isJtiRevoked(jti)).toBe(false);
    expect(() => revokeJti('revoke-missing-1')).not.toThrow();
    expect(isJtiRevoked('revoke-missing-1')).toBe(true);
    // Login flow continues: a fresh login jti is NOT revoked and verifies.
    expect(isJtiRevoked(jti)).toBe(false);
    const fresh = signJwtWithJti('user-login-1');
    expect(isJtiRevoked(fresh.jti)).toBe(false);
    // Let the fire-and-forget persist settle without unhandled rejection.
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe('isJtiRevokedWithDb read-through', () => {
  it('returns memory hits without touching the DB', async () => {
    revokeJti('mem-hit-1');
    await new Promise((r) => setTimeout(r, 10));
    mockFindUnique.mockClear();
    await expect(isJtiRevokedWithDb('mem-hit-1')).resolves.toBe(true);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it('fails open (false, no throw) when the table is missing', async () => {
    mockFindUnique.mockRejectedValueOnce(p2021());
    await expect(isJtiRevokedWithDb('db-missing-1')).resolves.toBe(false);
  });

  it('memoizes DB hits into memory', async () => {
    mockFindUnique.mockResolvedValueOnce({ jti: 'db-hit-1' });
    await expect(isJtiRevokedWithDb('db-hit-1')).resolves.toBe(true);
    expect(isJtiRevoked('db-hit-1')).toBe(true);
  });

  it('returns false on DB miss without throwing', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await expect(isJtiRevokedWithDb('db-miss-1')).resolves.toBe(false);
  });
});

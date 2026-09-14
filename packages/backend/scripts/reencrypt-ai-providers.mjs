#!/usr/bin/env node
/**
 * CampusFlow AI provider re-encryption — LOCAL one-off for AI_ENCRYPTION_KEY rotation.
 *
 * WHAT: decrypts every AiProvider.apiKey row with the OLD key and re-encrypts
 * with the NEW key in `v1:` HKDF-SHA256 format (see src/utils/encryption.ts).
 * New rows are ALWAYS written as `v1:`; OLD rows may be `v1:` or legacy
 * (no-prefix ASCII-slice) — both decrypt paths are supported for migration.
 *
 * SAFETY:
 * - DRY-RUN BY DEFAULT. No DB writes unless `--apply` is passed.
 * - Keys come ONLY from env vars (never argv, never hardcoded, never logged).
 *   Supported names (first set wins):
 *     OLD: OLD_AI_ENCRYPTION_KEY | OLD_AI_KEY
 *     NEW: NEW_AI_ENCRYPTION_KEY | NEW_AI_KEY
 * - NOTHING secret is printed: logs show row id/name + format + ok/fail only.
 *   Ciphertext is truncated to a short prefix for shape debugging, plaintext
 *   is NEVER printed (not even masked — rotation logs must stay key-free).
 * - Refuses weak/placeholder keys (same blocklist as encryption.ts + config).
 * - Refuses to run `--apply` when OLD === NEW (no-op that only churns IVs).
 *
 * PREREQS: `npm ci` in packages/backend + generated Prisma client
 * (`npx prisma generate --schema=prisma/schema.prisma`). DB reachable via
 * DATABASE_URL (pooled URL is fine — this is plain row CRUD, no migrations).
 *
 * USAGE (PowerShell — never paste live keys into chat/issues/PRs):
 *   # 1) Dry run (default, read-only — start here):
 *   $env:OLD_AI_ENCRYPTION_KEY="<old-key>"; $env:NEW_AI_ENCRYPTION_KEY="<new-key>"
 *   node scripts/reencrypt-ai-providers.mjs
 *   # same, explicit: node scripts/reencrypt-ai-providers.mjs --dry-run
 *
 *   # 2) Scoped check (one row / first N rows, still read-only):
 *   node scripts/reencrypt-ai-providers.mjs --only-id <cuid> --limit 10
 *
 *   # 3) Apply (writes new ciphertext + verifies round-trip per row):
 *   node scripts/reencrypt-ai-providers.mjs --apply
 *
 *   # 4) Machine-readable summary (counts only, still key-free):
 *   node scripts/reencrypt-ai-providers.mjs --json
 *
 *   # 5) Offline crypto self-test (no DB — proves HKDF/v1 path without keys in code):
 *   $env:NEW_AI_ENCRYPTION_KEY="<new-key>"
 *   node scripts/reencrypt-ai-providers.mjs --selftest
 *
 * EXIT CODES: 0 = all rows ok (dry-run: all WOULD re-encrypt; apply: all written
 * + verified). 1 = one or more rows failed to decrypt/verify (nothing half-written
 * for failed rows — each row updates atomically; rerun after fixing keys).
 * 2 = config/usage error (missing/weak keys, OLD===NEW on --apply, bad flags).
 *
 * FULL ROTATION ORDER: see docs/ROTATE-SECRETS.md §4 (maintenance on → dry-run →
 * apply → update Render AI_ENCRYPTION_KEY → redeploy → spot-check decrypt +
 * POST /api/ai test → maintenance off).
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const HKDF_SALT = Buffer.from('campusflow-ai-v1-salt', 'utf-8');
const HKDF_INFO = Buffer.from('campusflow-ai-v1', 'utf-8');
const WEAK_RE = /campusflow|random-string|replace_me|dev-encryption|change-me|your-key|example/i;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
function hasFlag(name) {
  return args.includes(`--${name}`);
}
function optValue(name) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0) {
    const v = args[i + 1];
    if (v && !v.startsWith('--')) return v;
  }
  return undefined;
}
function usageError(msg) {
  console.error(`[reencrypt] ERROR: ${msg}`);
  console.error(`[reencrypt] Usage: OLD_AI_ENCRYPTION_KEY=<old> NEW_AI_ENCRYPTION_KEY=<new> node scripts/reencrypt-ai-providers.mjs [--apply] [--dry-run] [--only-id ID] [--limit N] [--json] [--selftest] [--help]`);
  process.exit(2);
}

if (hasFlag('help') || hasFlag('h')) {
  console.log(`reencrypt-ai-providers.mjs — AI_ENCRYPTION_KEY rotation helper (dry-run default).

Env (keys ONLY via env, never argv):
  OLD_AI_ENCRYPTION_KEY | OLD_AI_KEY    old key (decrypt)
  NEW_AI_ENCRYPTION_KEY | NEW_AI_KEY    new key (encrypt, >=32 chars, openssl rand -hex 32)

Flags:
  --apply        WRITE new ciphertext to DB (default without it = dry-run, no writes)
  --dry-run      explicit read-only mode (default)
  --only-id ID   restrict to one AiProvider id
  --limit N      process at most N rows (verification sampling)
  --json         print machine-readable summary { total, ok, failed, ... } (key-free)
  --selftest     offline HKDF v1 round-trip with NEW key only (no DB, no OLD key needed)
  --help         this text

Order: maintenance on → dry-run → --apply → Render AI_ENCRYPTION_KEY → redeploy → spot-check.`);
  process.exit(0);
}

const APPLY = hasFlag('apply');
const SELFTEST = hasFlag('selftest');
const JSON_OUT = hasFlag('json');
const ONLY_ID = optValue('only-id');
const LIMIT_RAW = optValue('limit');
let LIMIT = 0;
if (LIMIT_RAW !== undefined) {
  LIMIT = parseInt(String(LIMIT_RAW), 10);
  if (!Number.isFinite(LIMIT) || LIMIT <= 0) usageError(`--limit must be a positive integer (got "${LIMIT_RAW}")`);
}

// --dry-run + --apply together is contradictory (apply wins would surprise) → reject.
if (APPLY && hasFlag('dry-run')) usageError('pass either --apply (write) or --dry-run (read-only), not both');

// Unknown-flag guard (typo safety — a mistyped --aply must not silently dry-run).
const KNOWN = new Set(['--apply', '--dry-run', '--only-id', '--limit', '--json', '--selftest', '--help', '--h']);
for (const a of args) {
  if (a.startsWith('--') && !KNOWN.has(a)) usageError(`unknown flag "${a}"`);
}

// ---------------------------------------------------------------------------
// Key handling (env only — never argv)
// ---------------------------------------------------------------------------
function pickEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v !== undefined && v !== '') return { name: n, value: v };
  }
  return { name: names[0], value: '' };
}

function assertStrongKey(label, value, { allowMissing = false } = {}) {
  if (!value) {
    if (allowMissing) return;
    usageError(`${label} is missing — export it in env (e.g. $env:${label}="<value>") — never pass keys as CLI args`);
  }
  if (value.length < 32) {
    console.error(`[reencrypt] ERROR: ${label} must be at least 32 characters (generate with \`openssl rand -hex 32\`)`);
    process.exit(2);
  }
  if (WEAK_RE.test(value)) {
    console.error(`[reencrypt] ERROR: ${label} looks like a placeholder/weak default — generate with \`openssl rand -hex 32\``);
    process.exit(2);
  }
}

function deriveV1Key(keyStr) {
  const ikm = /^[0-9a-fA-F]{64}$/.test(keyStr.trim())
    ? Buffer.from(keyStr.trim(), 'hex')
    : Buffer.from(keyStr, 'utf-8');
  return Buffer.from(crypto.hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, 32));
}
function deriveLegacyKey(keyStr) {
  return Buffer.from(keyStr.slice(0, 32), 'utf-8');
}

function decryptWithKeyMaterial(cipher, v1Key, legacyKey) {
  // Returns { plain, format } or throws. Tries v1 path first, then legacy.
  if (cipher.startsWith('v1:')) {
    const parts = cipher.slice(3).split(':');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('malformed v1 ciphertext shape');
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const data = Buffer.from(parts[2], 'hex');
    const d = crypto.createDecipheriv(ALGORITHM, v1Key, iv);
    d.setAuthTag(tag);
    return { plain: d.update(data) + d.final('utf-8'), format: 'v1' };
  }
  const parts = cipher.split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('malformed legacy ciphertext shape');
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const data = Buffer.from(parts[2], 'hex');
  const d = crypto.createDecipheriv(ALGORITHM, legacyKey, iv);
  d.setAuthTag(tag);
  return { plain: d.update(data) + d.final('utf-8'), format: 'legacy' };
}

function encryptV1(plain, v1Key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const c = crypto.createCipheriv(ALGORITHM, v1Key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf-8'), c.final()]);
  return `v1:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

function decryptV1Only(cipher, v1Key) {
  // Strict NEW-key verifier: only accepts v1: shape (what we just wrote).
  if (!cipher.startsWith('v1:')) throw new Error('expected v1: ciphertext');
  const parts = cipher.slice(3).split(':');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new Error('malformed v1 ciphertext shape');
  const d = crypto.createDecipheriv(ALGORITHM, v1Key, Buffer.from(parts[0], 'hex'));
  d.setAuthTag(Buffer.from(parts[1], 'hex'));
  return d.update(Buffer.from(parts[2], 'hex')) + d.final('utf-8');
}

// Short non-sensitive shape hint for logs (prefix only — no key material;
// ciphertext alone is useless without the key, full values still never logged).
function cipherHint(cipher) {
  const s = String(cipher || '');
  const fmt = s.startsWith('v1:') ? 'v1' : s.split(':').length === 3 ? 'legacy?' : 'malformed';
  return `${fmt} len=${s.length} prefix=${s.slice(0, 12)}…`;
}

// ---------------------------------------------------------------------------
// Offline self-test (no DB)
// ---------------------------------------------------------------------------
const newPick = pickEnv('NEW_AI_ENCRYPTION_KEY', 'NEW_AI_KEY');
if (SELFTEST) {
  assertStrongKey(newPick.name, newPick.value);
  const k = deriveV1Key(newPick.value);
  const probe = `selftest-${Date.now()}`;
  const ct = encryptV1(probe, k);
  if (!ct.startsWith('v1:')) {
    console.error('[reencrypt:selftest] FAIL — encrypt did not produce v1: prefix');
    process.exit(1);
  }
  const back = decryptV1Only(ct, k);
  if (back !== probe) {
    console.error('[reencrypt:selftest] FAIL — round-trip mismatch');
    process.exit(1);
  }
  // Wrong-key must NOT decrypt (auth tag fails closed).
  const wrong = deriveV1Key('f'.repeat(64) === newPick.value.trim() ? 'e'.repeat(64) : 'f'.repeat(64));
  let wrongFailed = false;
  try {
    decryptV1Only(ct, wrong);
  } catch {
    wrongFailed = true;
  }
  if (!wrongFailed) {
    console.error('[reencrypt:selftest] FAIL — wrong key decrypted (GCM auth broken?)');
    process.exit(1);
  }
  console.log('[reencrypt:selftest] PASS — v1 encrypt → decrypt round-trips; wrong key fails closed.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// DB path
// ---------------------------------------------------------------------------
const oldPick = pickEnv('OLD_AI_ENCRYPTION_KEY', 'OLD_AI_KEY');
assertStrongKey(oldPick.name, oldPick.value);
assertStrongKey(newPick.name, newPick.value);
if (oldPick.value === newPick.value) {
  if (APPLY) {
    console.error('[reencrypt] ERROR: OLD and NEW keys are identical — --apply would only churn IVs. Generate a fresh key (`openssl rand -hex 32`).');
    process.exit(2);
  }
  console.error('[reencrypt] WARN: OLD and NEW keys are identical — dry-run will trivially succeed; generate a fresh NEW key before real rotation.');
}

const oldV1Key = deriveV1Key(oldPick.value);
const oldLegacyKey = deriveLegacyKey(oldPick.value);
const newV1Key = deriveV1Key(newPick.value);

if (!process.env.DATABASE_URL) {
  console.error('[reencrypt] ERROR: DATABASE_URL is not set — Prisma cannot connect. Export the pooled URL in env (same value Render uses for DATABASE_URL).');
  process.exit(2);
}

let PrismaClient;
try {
  ({ PrismaClient } = await import('@prisma/client'));
} catch (e) {
  console.error('[reencrypt] ERROR: could not import @prisma/client. Run `npm ci` + `npx prisma generate --schema=prisma/schema.prisma` first.');
  console.error(`[reencrypt] detail: ${String(e?.message || e).slice(0, 200)}`);
  process.exit(2);
}

const prisma = new PrismaClient();
const mode = APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (read-only, no writes)';
if (!JSON_OUT) console.log(`[reencrypt] mode: ${mode} — old=${oldPick.name} new=${newPick.name}`);

try {
  const rows = await prisma.aiProvider.findMany({
    ...(ONLY_ID ? { where: { id: ONLY_ID } } : {}),
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
    orderBy: { name: 'asc' },
    select: { id: true, name: true, apiKey: true, enabled: true },
  });

  if (ONLY_ID && rows.length === 0) {
    console.error(`[reencrypt] ERROR: no AiProvider found with id "${ONLY_ID}"`);
    await prisma.$disconnect();
    process.exit(2);
  }

  let ok = 0;
  let failed = 0;
  let v1Count = 0;
  let legacyCount = 0;
  const failures = [];

  for (const row of rows) {
    let plain;
    let oldFormat;
    try {
      const r = decryptWithKeyMaterial(row.apiKey, oldV1Key, oldLegacyKey);
      plain = r.plain;
      oldFormat = r.format;
      if (oldFormat === 'v1') v1Count++;
      else legacyCount++;
    } catch (e) {
      failed++;
      failures.push({ id: row.id, name: row.name, reason: `OLD-key decrypt failed (${String(e?.message || e).slice(0, 120)})`, hint: cipherHint(row.apiKey) });
      if (!JSON_OUT) console.log(`[reencrypt] FAIL id=${row.id} name="${row.name}" — OLD-key decrypt failed (${cipherHint(row.apiKey)}). Check OLD key is correct; row left untouched.`);
      continue;
    }

    // Re-encrypt with NEW key + verify round-trip BEFORE any write.
    let newCt;
    try {
      newCt = encryptV1(plain, newV1Key);
      const back = decryptV1Only(newCt, newV1Key);
      if (back !== plain) throw new Error('round-trip mismatch');
      if (!newCt.startsWith('v1:')) throw new Error('new ciphertext missing v1: prefix');
    } catch (e) {
      failed++;
      failures.push({ id: row.id, name: row.name, reason: `NEW-key re-encrypt/verify failed (${String(e?.message || e).slice(0, 120)})` });
      if (!JSON_OUT) console.log(`[reencrypt] FAIL id=${row.id} name="${row.name}" — NEW-key verify failed. Row left untouched.`);
      continue;
    }

    if (APPLY) {
      try {
        await prisma.aiProvider.update({ where: { id: row.id }, data: { apiKey: newCt } });
        ok++;
        if (!JSON_OUT) console.log(`[reencrypt] OK id=${row.id} name="${row.name}" ${oldFormat} → v1 (rewritten + verified)`);
      } catch (e) {
        failed++;
        failures.push({ id: row.id, name: row.name, reason: `DB write failed (${String(e?.message || e).slice(0, 160)})` });
        if (!JSON_OUT) console.log(`[reencrypt] FAIL id=${row.id} name="${row.name}" — DB write failed. Rerun after fixing connectivity.`);
      }
    } else {
      ok++;
      if (!JSON_OUT) console.log(`[reencrypt] WOULD id=${row.id} name="${row.name}" ${oldFormat} → v1 (decrypts OK, not written — pass --apply to write)`);
    }
    // Plaintext + both ciphertexts stay out of logs by design (see header).
    plain = null;
    newCt = null;
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    total: rows.length,
    ok,
    failed,
    oldV1: v1Count,
    oldLegacy: legacyCount,
    ...(LIMIT > 0 ? { limit: LIMIT } : {}),
    ...(ONLY_ID ? { onlyId: ONLY_ID } : {}),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...summary, failures: failures.map((f) => ({ id: f.id, name: f.name, reason: f.reason })) }));
  } else {
    console.log(`[reencrypt] summary: total=${summary.total} ok=${ok} failed=${failed} (old v1=${v1Count}, old legacy=${legacyCount})`);
    if (!APPLY) console.log('[reencrypt] DRY-RUN complete — no rows were written. Rerun with --apply to commit.');
    else console.log('[reencrypt] APPLY complete — every OK row was rewritten as v1: + verified. Next: update Render AI_ENCRYPTION_KEY → redeploy → spot-check (see docs/ROTATE-SECRETS.md §4).');
  }
  process.exitCode = failed > 0 ? 1 : 0;
} finally {
  try {
    await prisma.$disconnect();
  } catch { /* ignore disconnect errors */ }
}

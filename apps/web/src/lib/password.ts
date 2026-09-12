/**
 * Secure password helpers (C3 fix) — replaces weak `password123` defaults.
 * - generateSecurePassword: crypto.getRandomValues, 16 chars, upper/lower/digit/symbol
 * - isCommonPassword: local blocklist mirror (backend is authority)
 * - checkPasswordBreach: HIBP k-anonymity (SHA-1 prefix), offline-safe fail-open
 *   with console warn; backend enforces fail-closed when HIBP_STRICT=true.
 */

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*';

export function generateSecurePassword(length = 16): string {
  const all = UPPER + LOWER + DIGITS + SYMBOLS;
  const buf = new Uint32Array(length);
  try {
    crypto.getRandomValues(buf);
  } catch {
    // Fallback (non-secure, tests only) — production browsers always have crypto
    for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 4294967296);
  }
  let out = '';
  // Guarantee at least one of each class for first 4 chars
  const classes = [UPPER, LOWER, DIGITS, SYMBOLS];
  for (let i = 0; i < length; i++) {
    const pool = i < 4 ? classes[i] : all;
    out += pool[buf[i] % pool.length];
  }
  // Shuffle to avoid predictable prefix positions
  const arr = out.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = buf[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

const COMMON = new Set(['password123', 'password', '12345678', 'qwerty123', 'letmein123', 'welcome123', 'admin123']);

export function isCommonPasswordLocal(pw: string): boolean {
  if (!pw) return true;
  return COMMON.has(String(pw).toLowerCase().trim()) || String(pw).length < 8;
}

async function sha1Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * HIBP breach check hook (frontend hint, backend enforces).
 * Returns { breached, offline }. Never throws; offline => { breached:false, offline:true }.
 * Documented TODO: backend HIBP_STRICT=true fails closed when HIBP offline.
 */
export async function checkPasswordBreachHook(password: string): Promise<{ breached: boolean; offline: boolean }> {
  try {
    const sha1 = await sha1Hex(String(password));
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) throw new Error(`HIBP ${resp.status}`);
    const text = await resp.text();
    const hit = text.split('\n').some((l) => l.split(':')[0]?.trim().toUpperCase() === suffix);
    return { breached: hit, offline: false };
  } catch {
    return { breached: false, offline: true };
  }
}

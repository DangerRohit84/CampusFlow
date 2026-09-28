// opportunities/prizeCurrency.ts — preserve original currency (prize bug fix).
// WHY: backend fetchers preserve "$400" (devpost headline, devfolio $ tiers,
// unstop $ stipends), but frontend formatters stripped the symbol
// (`m.replace(/[₹$,]/g,'')`) then hardcoded `₹${max}` — "$400" rendered as
// "₹400". This SSOT detects the source symbol and formats with it; no FX
// conversion anywhere (no *83, no exchange). Frontend mirrors this logic.

export type PrizeCurrency = '₹' | '$';

const AMOUNT_RE = /([₹$])\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lac|k|L|K|cr|Cr))?/gi;

/** First currency symbol in text ($ wins if present first, else ₹, default ₹). */
export function detectPrizeCurrency(text: string): PrizeCurrency {
  if (!text) return '₹';
  const m = String(text).match(/[₹$]/);
  if (!m) return '₹';
  return (m[0] as PrizeCurrency) ?? '₹';
}

function parseAmountToNumber(rawNum: string, suffix?: string): number {
  let num = parseFloat(String(rawNum).replace(/,/g, '').trim());
  if (!Number.isFinite(num)) return NaN;
  const s = String(suffix ?? '');
  if (/lakh|lac/i.test(s)) num *= 100000;
  else if (/cr/i.test(s)) num *= 10000000;
  else if (/^k$/i.test(s.trim()) || /k/i.test(s)) {
    // 'k' suffix (e.g. $5k) — same as frontend legacy behavior.
    if (/k/i.test(s)) num *= 1000;
  }
  return num;
}

/** Parse all amounts with their symbols (for display + tests). */
export function extractPrizeAmountsWithCurrency(text: string): Array<{ symbol: PrizeCurrency; value: number }> {
  if (!text) return [];
  const out: Array<{ symbol: PrizeCurrency; value: number }> = [];
  const s = String(text);
  AMOUNT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AMOUNT_RE.exec(s)) !== null) {
    const symbol = (m[1] as PrizeCurrency) ?? '₹';
    const v = parseAmountToNumber(m[2], m[3]);
    if (!Number.isFinite(v) || v <= 0) continue;
    out.push({ symbol, value: v });
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Compact display preserving original currency.
 * - No amounts → truncated original (legacy fallback, ≤40 chars).
 * - Single amount → "<sym><max>" (e.g. "$400", not "₹400").
 * - Multiple → "<sym><max> / <sym><total>" with the FIRST symbol (mixed pools
 *   keep source symbol; never converts $→₹).
 * Locale: en-IN for ₹, en-US for $ (so $1,000 not $1,00,000).
 */
export function formatPrizeDisplay(text: string): string {
  if (!text) return '';
  const s = String(text);
  const amounts = extractPrizeAmountsWithCurrency(s);
  if (amounts.length === 0) return s.length > 40 ? s.slice(0, 40) + '⬦' : s;
  const symbol = amounts[0].symbol;
  const values = amounts.map((a) => a.value);
  const max = Math.max(...values);
  const total = values.length > 1 ? values.reduce((a, b) => a + b, 0) : null;
  const locale = symbol === '$' ? 'en-US' : 'en-IN';
  const fmt = (n: number) => n.toLocaleString(locale);
  if (total !== null && total !== max) return `${symbol}${fmt(max)} / ${symbol}${fmt(total)}`;
  return `${symbol}${fmt(max)}`;
}

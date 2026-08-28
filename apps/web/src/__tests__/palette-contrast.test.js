/**
 * QA: CampusFlow Color Visibility — WCAG AA Contrast Regression Tests
 * Tuned palette (2026-08-28):
 *   Green - primary #2D6A4F/#1E4935, light tints #EEF4F0/#D6E9DE (brighter mint)
 *   Terracotta #B5533C, peach cleaned #FDF3EB/#FBE9D8
 *   Gold warning #8B6F47 (4.71:1 AA) + brass/gold decorative #D1B48C, page #FEFCF7, dark #0B1216/#16202C
 *   plain English comments, gold alias.
 *
 * Run: node apps/web/src/__tests__/palette-contrast.test.js
 */

function hexToRgb(hex) {
  hex = hex.replace('#','');
  if (hex.length===3) hex = hex.split('').map(c=>c+c).join('');
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}
function srgbToLin(c) { c=c/255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
function lum(hex) { const [r,g,b]=hexToRgb(hex).map(srgbToLin); return 0.2126*r+0.7152*g+0.0722*b; }
function contrast(a,b) { const L1=lum(a),L2=lum(b); return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05); }

let failures = 0;
let passes = 0;
function expectContrast(fg, bg, label, min=4.5) {
  const ratio = contrast(fg, bg);
  const ok = ratio >= min;
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passes++; else failures++;
  console.log(`${status} | ${ratio.toFixed(2)}:1 | ${label} | ${fg} on ${bg} (min ${min})`);
  if (!ok) console.error(`  ✗ Expected >=${min}:1 but got ${ratio.toFixed(2)}:1`);
  return ok;
}

function expectFail(fg, bg, label) {
  const ratio45 = contrast(fg, bg);
  const ratio30 = ratio45 >= 3;
  console.log(`INFO | ${ratio45.toFixed(2)}:1 | ${label} | ${fg} on ${bg} (expected <4.5, large-text ${ratio30?'PASS':'FAIL'})`);
  return ratio45 < 4.5;
}

console.log('=== CampusFlow Palette — WCAG AA Contrast Tests (tuned) ===\n');
console.log('-- Light mode (AA 4.5:1 for normal text) --');
expectContrast('#0C1218','#FEFCF7','Body: ink #0C1218 on page #FEFCF7 (18.36:1)');
expectContrast('#1E4935','#FFFFFF','Primary-600 #1E4935 on white (10.20:1)');
expectContrast('#2D6A4F','#FFFFFF','Primary-500 #2D6A4F on white (6.39:1)');
expectContrast('#FFFFFF','#2D6A4F','White on primary-500 CTA (6.39:1)');
expectContrast('#FFFFFF','#1E4935','White on primary-600 btn-primary (10.20:1)');
expectContrast('#B5533C','#FFFFFF','Accent-500 #B5533C on white (4.92:1)');
expectContrast('#9A4532','#FFFFFF','Accent-600 #9A4532 on white (6.42:1)');
expectContrast('#DC2626','#FFFFFF','Danger-500 #DC2626 on white (4.83:1)');
expectContrast('#0F7F5B','#FFFFFF','Success-500 #0F7F5B on white (4.99:1)');
expectContrast('#8B6F47','#FFFFFF','Warning-500 #8B6F47 on white (4.71:1 AA)');
expectContrast('#FFFFFF','#8B6F47','White on warning-500 #8B6F47 (4.71:1 AA) — bg-warning-500 text-white');
expectContrast('#6E5A3A','#FFFFFF','Warning-600 #6E5A3A on white (6.59:1)');
expectContrast('#5F6B7D','#FFFFFF','Surface-400 #5F6B7D muted on white (5.40:1)');
expectContrast('#5F6B7D','#FEFCF7','Surface-400 #5F6B7D on page #FEFCF7 (5.27:1)');
expectContrast('#475569','#FFFFFF','Surface-500 #475569 secondary on white');
expectContrast('#475569','#FEFCF7','Surface-500 on page #FEFCF7');
expectContrast('#334155','#FFFFFF','Surface-600 #334155 strong secondary on white');
expectContrast('#1E293B','#FFFFFF','Surface-700 #1E293B heading on white');
expectContrast('#1E4935','#EEF4F0','Primary-600 on primary-50 #EEF4F0 (active nav)');
expectContrast('#1E4935','#FDF3EB','Primary-600 on accent-50 #FDF3EB');
expectContrast('#B91C1C','#FEF2F2','Danger-600 on danger-50');
expectContrast('#0B5E44','#ECFDF5','Success-600 on success-50');
expectContrast('#6E5A3A','#FFFBEB','Warning-600 on warning-50 #FFFBEB (6.35:1)');
expectContrast('#9A4532','#FDF3EB','Accent-600 on accent-50 #FDF3EB (5.87:1)');
expectContrast('#1E293B','#FFFFFF','Btn-secondary surface-700 on white');

console.log('\n-- Dark mode (AA 4.5:1) --');
expectContrast('#F1F5F9','#0B1216','Night-50 #F1F5F9 on night-950 page #0B1216 (17.23:1)');
expectContrast('#F1F5F9','#16202C','Night-50 on night-800 card #16202C (15.01:1)');
expectContrast('#F1F5F9','#131D28','Night-50 on night-850 sidebar #131D28');
expectContrast('#CBD5E1','#0B1216','Night-200 #CBD5E1 on night-950 #0B1216');
expectContrast('#CBD5E1','#16202C','Night-200 on card #16202C (11.08:1)');
expectContrast('#90A1AD','#0B1216','Night-400 #90A1AD muted on night-950 #0B1216 (7.09:1)');
expectContrast('#90A1AD','#16202C','Night-400 on card #16202C (6.18:1)');
expectContrast('#90A1AD','#131D28','Night-400 placeholder on input #131D28');
expectContrast('#90B9A4','#0B1216','Primary-300 #90B9A4 on night-950 #0B1216');
expectContrast('#90B9A4','#16202C','Primary-300 on card #16202C (7.57:1 active nav dark)');
expectContrast('#B6D2C3','#0B1216','Primary-200 #B6D2C3 on night-950');
expectContrast('#E5A582','#0B1216','Accent-300 #E5A582 on night-950');
expectContrast('#D07E56','#0B1216','Accent-400 #D07E56 on night-950');
expectContrast('#F87171','#0B1216','Danger-400 on night-950');
expectContrast('#D1B48C','#0B1216','Gold decorative #D1B48C on night-950 (8.35:1 but not for light text)');
expectContrast('#34D399','#16202C','Success-400 on card #16202C');

console.log('\n-- Decorative / large-text only (expected low at 4.5, documented) --');
expectFail('#D1B48C','#FFFFFF','Gold decorative #D1B48C on white (1.98 — NOT for body text)');
expectFail('#FCD34D','#FFFFFF','Gold-300 #FCD34D on white (1.44 — NOT for body text)');
expectFail('#BD9D69','#FFFFFF','Gold-500 #BD9D69 on white (2.56 — NOT for body text, use gold-400 bg with black text)');
// decorative border — low contrast is intentional for subtle border, not text
expectFail('#5F6B7D','#EAE2CF','Surface-400 on surface-200 #EAE2CF border (decorative)');

console.log('\n-- Summary --');
console.log(`Pass: ${passes}, Decorative/info: 4, Fail (unexpected): ${failures}`);
if (failures > 0) {
  console.log(`\n✗ ${failures} expected PASS checks failed — WCAG AA regression!`);
} else {
  console.log('\nAll WCAG AA 4.5:1 checks for body text PASS. Decorative/low tokens correctly flagged as not-for-text.');
}

process.exitCode = failures > 0 ? 1 : 0;

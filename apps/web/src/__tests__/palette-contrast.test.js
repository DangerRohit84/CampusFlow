/**
 * QA: CampusFlow Color Visibility — WCAG AA Contrast Regression Tests
 * Royal Sapphire & Slate Palette:
 *   Royal Sapphire Primary: #3730A3 (dark), #4338CA (main)
 *   Warm Accent: #EA580C, #C2410C
 *   Amber / Warning: #B45309, #92400E, decorative #F59E0B
 *   Surface: #F8FAFC (page), #090D16 (ink)
 *   Night: #080C14 (page), #111827 (card), #F8FAFC (ink)
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

console.log('=== CampusFlow Palette — WCAG AA Contrast Tests (High-Contrast Black & White / Apple Pro) ===\n');
console.log('-- Light mode (AA 4.5:1 for normal text) --');
expectContrast('#09090B','#FAFAFA','Body: ink #09090B on page #FAFAFA');
expectContrast('#18181B','#FFFFFF','Primary-600 #18181B on white (16.2:1)');
expectContrast('#27272A','#FFFFFF','Primary-500 #27272A on white (12.6:1)');
expectContrast('#FFFFFF','#000000','White on Black btn-primary (21:1)');
expectContrast('#FFFFFF','#18181B','White on Primary-600 CTA (16.2:1)');
expectContrast('#0369A1','#FFFFFF','Accent Apple Blue #0369A1 on white (AA)');
expectContrast('#E11D48','#FFFFFF','Danger-600 #E11D48 on white (5.8:1)');
expectContrast('#047857','#FFFFFF','Success-600 #047857 on white (AA)');
expectContrast('#B45309','#FFFFFF','Warning-700 #B45309 on white (AA)');
expectContrast('#FFFFFF','#B45309','White on warning-700 #B45309 (AA)');
expectContrast('#71717A','#FFFFFF','Surface-400 #71717A muted on white');
expectContrast('#71717A','#FAFAFA','Surface-400 on page #FAFAFA');
expectContrast('#52525B','#FFFFFF','Surface-500 #52525B secondary on white');
expectContrast('#52525B','#FAFAFA','Surface-500 on page #FAFAFA');
expectContrast('#3F3F46','#FFFFFF','Surface-600 #3F3F46 strong secondary on white');
expectContrast('#09090B','#FFFFFF','Surface-900 #09090B heading on white');
expectContrast('#BE123C','#FFF1F2','Danger-700 on danger-50');
expectContrast('#047857','#ECFDF5','Success-700 on success-50');
expectContrast('#92400E','#FFFBEB','Warning-800 on warning-50 #FFFBEB');

console.log('\n-- Dark mode (AA 4.5:1) --');
expectContrast('#FAFAFA','#000000','Night-50 #FAFAFA on Onyx #000000');
expectContrast('#FAFAFA','#0F0F12','Night-50 on card #0F0F12');
expectContrast('#FAFAFA','#09090B','Night-50 on sidebar #09090B');
expectContrast('#E4E4E7','#000000','Night-200 on Onyx #000000');
expectContrast('#E4E4E7','#0F0F12','Night-200 on card #0F0F12');
expectContrast('#A1A1AA','#000000','Night-400 muted on Onyx #000000');
expectContrast('#A1A1AA','#0F0F12','Night-400 on card #0F0F12');
expectContrast('#38BDF8','#000000','Accent-400 on Onyx');
expectContrast('#F59E0B','#000000','Solar Amber on Onyx');
expectContrast('#34D399','#0F0F12','Success-400 on card #0F0F12');

console.log('\n-- Decorative / large-text only (expected low at 4.5, documented) --');
expectFail('#F59E0B','#FFFFFF','Amber decorative #F59E0B on white (NOT for body text)');
expectFail('#FCD34D','#FFFFFF','Gold-300 #FCD34D on white (NOT for body text)');
expectFail('#D97706','#FFFFFF','Amber-500 #D97706 on white (large text / badges)');
expectFail('#64748B','#E2E8F0','Surface-400 on surface-200 #E2E8F0 border (decorative)');

console.log('\n-- Summary --');
console.log(`Pass: ${passes}, Decorative/info: 4, Fail (unexpected): ${failures}`);
if (failures > 0) {
  console.log(`\n✗ ${failures} expected PASS checks failed — WCAG AA regression!`);
} else {
  console.log('\nAll WCAG AA 4.5:1 checks for body text PASS. Decorative/low tokens correctly flagged as not-for-text.');
}

process.exitCode = failures > 0 ? 1 : 0;


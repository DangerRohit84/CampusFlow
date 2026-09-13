// src/brand-kit.test.ts — locks CampusFlow brand kit v1.0 application.
// WHY: logo drift (GraduationCap placeholders, wrong greens, missing favicon)
// regresses silently. This test fails if brand masters are deleted, index.html
// points to legacy assets, or tailwind palette drifts from guide HEX.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

function p(...parts: string[]): string {
  return join(ROOT, ...parts)
}

describe('brand-kit assets exist', () => {
  it('copies favicon.ico and apple-touch-icon to public', () => {
    expect(existsSync(p('public', 'favicon.ico'))).toBe(true)
    expect(existsSync(p('public', 'apple-touch-icon.png'))).toBe(true)
  })

  it('copies C-icon masters (svg + 16/32/64 + darktab) to public', () => {
    expect(existsSync(p('public', 'campusflow-icon.svg'))).toBe(true)
    expect(existsSync(p('public', 'campusflow-icon-16.png'))).toBe(true)
    expect(existsSync(p('public', 'campusflow-icon-32.png'))).toBe(true)
    expect(existsSync(p('public', 'campusflow-icon-64.png'))).toBe(true)
    expect(existsSync(p('public', 'campusflow-icon-darktab-16.png'))).toBe(true)
  })

  it('copies logo lockups (primary/reversed/mono svg+png) to public/brand and src/assets/brand', () => {
    const logos = [
      'campusflow-logo-primary.svg',
      'campusflow-logo-reversed.svg',
      'campusflow-logo-primary.png',
      'campusflow-logo-reversed.png',
      'campusflow-logo-mono-black.svg',
      'campusflow-logo-mono-white.svg',
    ]
    for (const f of logos) {
      expect(existsSync(p('public', 'brand', f))).toBe(true)
      expect(existsSync(p('src', 'assets', 'brand', f))).toBe(true)
    }
    expect(existsSync(p('src', 'assets', 'brand', 'campusflow-icon.svg'))).toBe(true)
  })
})

describe('brand-kit index.html', () => {
  it('references brand favicon, icon, apple-touch, theme-color and title', () => {
    const html = readFileSync(p('index.html'), 'utf-8')
    expect(html).toContain('/favicon.ico')
    expect(html).toContain('/campusflow-icon.svg')
    expect(html).toContain('/apple-touch-icon.png')
    expect(html).toContain('#1ED760')
    expect(html).toContain('<title>CampusFlow')
    expect(html).toContain('og-cover.png')
  })
})

describe('brand-kit palette locked', () => {
  it('locks tailwind brand greens with no new colors', () => {
    const cfg = readFileSync(p('tailwind.config.js'), 'utf-8')
    expect(cfg).toContain('#1ED760')
    expect(cfg).toContain('#0A7A3A')
    expect(cfg).toContain('#121212')
    // WHY: primary-500 must stay Brand Green; drift breaks logo contrast.
    expect(cfg).toContain("500: '#1ed760'")
  })
})

// logo-apply: header logo was 32px fixed + p-[4px] ON the <img> (border-box →
// 24px content: small + blurry). Locks the crisp fix: 38px desktop / 32px
// mobile, wrapper clearspace, pre-sized SVG, no CSS stretch.
describe('brand-kit logo-apply crisp header', () => {
  it('BrandLogo defaults to 38px desktop lockup with SVG (never PNG) + pre-sized attrs', () => {
    const src = readFileSync(p('src', 'components', 'BrandLogo.tsx'), 'utf-8')
    expect(src).toContain('height = 38')
    expect(src).toContain('/brand/campusflow-logo-primary.svg')
    expect(src).toContain('/brand/campusflow-logo-reversed.svg')
    expect(src).not.toContain('.png')
    // Pre-size: intrinsic width/height attrs + aspect-ratio (no CLS).
    expect(src).toContain('width={width}')
    expect(src).toContain('height={desktopHeight}')
    expect(src).toContain('aspectRatio')
    // No CSS stretch: width auto from ratio.
    expect(src).toContain('w-auto')
    // Above-the-fold: eager + high fetch priority, async decode.
    expect(src).toContain('fetchpriority')
    expect(src).toContain('decoding="async"')
  })

  it('BrandLogo keeps zero padding on <img>; clearspace lives on wrapper', () => {
    const src = readFileSync(p('src', 'components', 'BrandLogo.tsx'), 'utf-8')
    // Regression guard: p-[4px] must never return to the <img> (border-box
    // shrink rendered 32px as 24px). Clearspace is wrapper style padding.
    expect(src).not.toMatch(/className=\{`[^`]*p-\[/)
    expect(src).not.toContain('w-auto p-[4px]')
    expect(src).toContain('style={{ padding: CLEARSPACE }}')
    expect(src).toContain('.brand-logo-lockup')
  })

  it('BrandLogo serves responsive 28–32 mobile / 36–40 desktop via CSS vars', () => {
    const src = readFileSync(p('src', 'components', 'BrandLogo.tsx'), 'utf-8')
    const css = readFileSync(p('src', 'index.css'), 'utf-8')
    expect(src).toContain('--logo-h-mobile')
    expect(src).toContain('--logo-h-desktop')
    expect(css).toContain('.brand-logo-lockup')
    expect(css).toContain('--logo-h-mobile')
    expect(css).toContain('--logo-h-desktop')
    expect(css).toContain('@media (min-width: 640px)')
    // Mobile clamp 28–32, desktop default 38 sits in 36–40 band.
    expect(src).toContain('Math.max(28, Math.min(32, desktopHeight - 6))')
  })

  it('SVG masters carry width/height attrs + viewBox (vector-crisp at 200% zoom)', () => {
    for (const f of ['campusflow-logo-primary.svg', 'campusflow-logo-reversed.svg']) {
      const svg = readFileSync(p('public', 'brand', f), 'utf-8')
      expect(svg).toContain('viewBox="-166 -144 3302 859"')
      expect(svg).toContain('width="3302"')
      expect(svg).toContain('height="859"')
    }
    const icon = readFileSync(p('public', 'campusflow-icon.svg'), 'utf-8')
    expect(icon).toContain('viewBox=')
    expect(icon).toContain('width=')
    expect(icon).toContain('height=')
  })

  it('headers/footers use 38px lockup; collapsed rail stays icon-only 24px', () => {
    const layout = readFileSync(p('src', 'components', 'layout', 'Layout.tsx'), 'utf-8')
    expect(layout).toContain('<BrandLogo variant="auto" height={38} />')
    expect(layout).toContain('<BrandLogo variant="icon" height={24}')
    for (const f of [
      ['src', 'pages', 'LandingPage.tsx'],
      ['src', 'pages', 'LoginPage.tsx'],
      ['src', 'pages', 'RegisterPage.tsx'],
      ['src', 'components', 'PublicPageShell.tsx'],
    ] as string[][]) {
      const src = readFileSync(p(...f), 'utf-8')
      expect(src).toContain('height={38}')
      // No stale 32px lockups remain in headers (icon 24/32 tiles exempt).
      expect(src).not.toMatch(/variant="(auto|primary|reversed)" height=\{32\}/)
    }
  })

  it('sticky headers grow on sm+ so 38px lockup + clearspace never clips', () => {
    for (const f of [
      ['src', 'pages', 'LandingPage.tsx'],
      ['src', 'components', 'PublicPageShell.tsx'],
    ] as string[][]) {
      const src = readFileSync(p(...f), 'utf-8')
      expect(src).toContain('h-11 sm:h-14')
    }
  })
})

// components/BrandLogo.tsx — single brand lockup source (SRP: owns logo rendering).
// WHY: brand kit v1.0 mandates primary on light, reversed on dark #121212,
// 32px min digital height, clearspace 1x (green-bar height) on all sides.
// Centralizing avoids drift (was GraduationCap placeholders in 6 headers).
//
// WHY crisp fix (logo-apply): header lockup was 32px fixed + p-[4px] ON the
// <img> itself. Tailwind preflight is border-box, so height:32 + 8px padding
// squeezed content to 24px — looked small + soft (downscaled raster). Fix:
// clearspace lives on the WRAPPER (padding), <img> has zero padding +
// explicit width/height attrs + aspect-ratio so layout is pre-sized (no CLS)
// and the SVG stays vector-crisp at 100%/200% zoom. No CSS stretch: width
// derives from height via intrinsic ratio (3302/859 ≈ 3.84).
// Sizes follow top-site standard (Google/Amazon/Spotify/Flipkart): 36–40px
// desktop / 28–32px mobile. Desktop default 38px, mobile 32px via responsive
// class. 32px-min rule exception: header legibility allows 28–32 on mobile.

type BrandLogoVariant = 'auto' | 'primary' | 'reversed' | 'icon';

interface BrandLogoProps {
  /** auto = primary on light + reversed on dark; icon = C-icon only (for <32px or square rails). */
  variant?: BrandLogoVariant;
  /**
   * Desktop digital height in px. Default 38 (within 36–40 top-site band).
   * Mobile renders 32 (within 28–32 band) via responsive class — the sanctioned
   * 32px-min header-legibility exception. Below minimum callers must use variant="icon".
   */
  height?: number;
  className?: string;
  /** Alt text for a11y. Defaults to brand name (decorative contexts should pass alt=""). */
  alt?: string;
}

const LOGO_PRIMARY = '/brand/campusflow-logo-primary.svg';
const LOGO_REVERSED = '/brand/campusflow-logo-reversed.svg';
const LOGO_ICON = '/campusflow-icon.svg';

// WHY: lockup masters are viewBox="-166 -144 3302 859" width=3302 height=859.
// Intrinsic ratio reserves layout before the SVG loads (no CLS) and proves
// width/height attrs + viewBox are in sync. Icon master is 888x859.
const LOCKUP_ASPECT = 3302 / 859;
const ICON_ASPECT = 888 / 859;

// Desktop height → mobile height: clamp into 28–32 band (6px step, min 28).
function mobileHeight(desktopHeight: number): number {
  return Math.max(28, Math.min(32, desktopHeight - 6));
}

function lockupWidth(desktopHeight: number): number {
  return Math.round(desktopHeight * LOCKUP_ASPECT);
}

// WHY wrapper clearspace: 1x = green-bar height ≈ 12% of lockup height. 4px on
// 32–38px preserves clearspace WITHOUT shrinking the glyph (padding is on the
// wrapper — img itself has zero padding).
const CLEARSPACE = 4;

function LockupImg({
  src,
  alt,
  hidden,
  desktopHeight,
  eager,
}: {
  src: string;
  alt: string;
  hidden?: 'dark:hidden' | 'hidden dark:block';
  desktopHeight: number;
  eager: boolean;
}) {
  const mobile = mobileHeight(desktopHeight);
  const width = lockupWidth(desktopHeight);
  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      // WHY CLS: intrinsic attrs (desktop size) + aspect-ratio reserve the box
      // before fetch. CSS var heights scale mobile/desktop (width:auto follows
      // ratio — no stretch, no distortion). viewBox lives in the SVG file;
      // attrs here must stay in sync with it.
      width={width}
      height={desktopHeight}
      // WHY responsive: --logo-h-mobile (28–32) / --logo-h-desktop (36–40)
      // consumed by .brand-logo-lockup in index.css (static class — Tailwind
      // JIT cannot see dynamic h-[Npx], so responsive lives in CSS).
      className={`brand-logo-lockup block w-auto${hidden ? ` ${hidden}` : ''}`}
      style={{
        aspectRatio: String(LOCKUP_ASPECT),
        ['--logo-h-mobile' as string]: `${mobile}px`,
        ['--logo-h-desktop' as string]: `${desktopHeight}px`,
      } as React.CSSProperties}
      // WHY crisp: SVG (vector) in header — never PNG. eager + high priority
      // because header logo is above-the-fold LCP-adjacent; async decode
      // avoids blocking. draggable=false avoids ghost blur on drag.
      loading={eager ? 'eager' : 'lazy'}
      // @ts-expect-error — fetchPriority is valid in React 18+ DOM but missing from TS types here
      fetchpriority={eager ? 'high' : 'auto'}
      decoding="async"
      draggable={false}
    />
  );
}

function IconImg({ height, alt }: { height: number; alt: string }) {
  const size = Math.max(16, Math.round(height));
  return (
    <img
      src={LOGO_ICON}
      alt={alt}
      width={size}
      height={size}
      className="brand-logo-icon block shrink-0"
      style={{ aspectRatio: String(ICON_ASPECT), width: size, height: size }}
      loading="eager"
      // @ts-expect-error — fetchPriority is valid in React 18+ DOM but missing from TS types here
      fetchpriority="high"
      decoding="async"
      draggable={false}
    />
  );
}

export default function BrandLogo({
  variant = 'auto',
  height = 38,
  className = '',
  alt = 'CampusFlow',
}: BrandLogoProps) {
  if (variant === 'icon') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        style={{ width: Math.max(16, height), height: Math.max(16, height) }}
      >
        <IconImg height={height} alt={alt} />
      </span>
    );
  }

  // Clamp lockup desktop height into 36–40 band (min 32 legacy guard).
  const desktopHeight = Math.max(32, Math.round(height));

  if (variant === 'primary') {
    return (
      // WHY clearspace on wrapper (4px), zero padding on img — fixes the
      // border-box shrink that rendered 32px as 24px (small + blurry).
      <span
        className={`inline-flex items-center shrink-0 ${className}`}
        style={{ padding: CLEARSPACE }}
        role="img"
        aria-label={alt}
      >
        <LockupImg src={LOGO_PRIMARY} alt="" desktopHeight={desktopHeight} eager />
      </span>
    );
  }

  if (variant === 'reversed') {
    return (
      <span
        className={`inline-flex items-center shrink-0 ${className}`}
        style={{ padding: CLEARSPACE }}
        role="img"
        aria-label={alt}
      >
        <LockupImg src={LOGO_REVERSED} alt="" desktopHeight={desktopHeight} eager />
      </span>
    );
  }

  // WHY auto: CSS dark: variant swaps lockup (no JS, no flash). Both imgs share
  // identical metrics (same desktop/mobile heights + clearspace wrapper) so
  // light/dark have zero layout shift on theme toggle.
  return (
    <span
      className={`inline-flex items-center shrink-0 ${className}`}
      style={{ padding: CLEARSPACE }}
      role="img"
      aria-label={alt}
    >
      <LockupImg src={LOGO_PRIMARY} alt="" hidden="dark:hidden" desktopHeight={desktopHeight} eager />
      <LockupImg src={LOGO_REVERSED} alt="" hidden="hidden dark:block" desktopHeight={desktopHeight} eager />
    </span>
  );
}

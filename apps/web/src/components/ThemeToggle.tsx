import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, animate } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';
import './ThemeToggle.css';

const PULL_THRESHOLD = 32;
const TAP_PULL = 38;

export default function ThemeToggle() {
  const { dark, toggle } = useTheme();

  // free unlimited drag: distance = hypot(dx,dy) — angle = atan2(-dx, dy) free 360°, unlimited stretch
  const pull = useMotionValue(0);
  const angle = useMotionValue(0);
  const springPull = useSpring(pull, { stiffness: 420, damping: 26, mass: 0.5 });
  const springAngle = useSpring(angle, { stiffness: 320, damping: 28, mass: 0.55 });
  // old design cord base 20px + unlimited stretch
  const cordH = useTransform(springPull, (v) => 20 + v);
  const lampRotate = useTransform(springAngle, (v) => `${v}deg`);

  const [isDragging, setIsDragging] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const didToggleRef = useRef(false);
  const hasMovedRef = useRef(false);

  useEffect(() => {
    const unsub = springPull.on('change', (v) => setIsReady(v > PULL_THRESHOLD - 4));
    return () => unsub();
  }, [springPull]);

  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const snapBack = useCallback(() => {
    // FIX: recoil 90deg snap — was double-spring (animate spring on source + useSpring follower)
    // causing compound overshoot to 90deg when released from left. Use single-spring path:
    // tween source to 0 with easeOut and let useSpring (damping 28) handle smooth recoil to 0.
    // Also defer clearing isDragging so rotate stays bound to lampRotate during recoil.
    animate(pull, 0, { type: 'tween', ease: 'easeOut', duration: 0.32 });
    animate(angle, 0, { type: 'tween', ease: 'easeOut', duration: 0.34 });
    window.setTimeout(() => setIsDragging(false), 360);
  }, [pull, angle]);

  const triggerToggle = useCallback(() => {
    if (didToggleRef.current) return;
    didToggleRef.current = true;
    if ('vibrate' in navigator) {
      try {
        (navigator as any).vibrate?.(14);
      } catch {}
    }
    toggle();
    window.setTimeout(() => {
      didToggleRef.current = false;
    }, 820);
  }, [toggle]);

  const handleTapAnimate = useCallback(() => {
    if (didToggleRef.current) return;
    const jitter = (Math.random() - 0.5) * 6;
    animate(pull, TAP_PULL, { type: 'spring', stiffness: 720, damping: 18, mass: 0.42 });
    animate(angle, jitter, { type: 'spring', stiffness: 720, damping: 18, mass: 0.42 });
    window.setTimeout(() => triggerToggle(), prefersReduced ? 80 : 140);
    window.setTimeout(() => {
      // FIX: use damped tween for recoil to 0 — prevents 90deg overshoot on tap recoil
      animate(pull, 0, { type: 'tween', ease: 'easeOut', duration: 0.32 });
      animate(angle, 0, { type: 'tween', ease: 'easeOut', duration: 0.34 });
    }, prefersReduced ? 120 : 210);
  }, [pull, angle, triggerToggle, prefersReduced]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e as any).button !== undefined && (e as any).button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    setIsDragging(true);
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startTimeRef.current = Date.now();
    hasMovedRef.current = false;
    didToggleRef.current = false;
    e.preventDefault();
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - startXRef.current;
      const dy = e.clientY - startYRef.current;
      const dist = Math.hypot(dx, dy);
      if (dist > 3) hasMovedRef.current = true;
      // free unlimited drag anywhere — no angle clamp, full 360° via atan2(-dx, dy)
      // distance = hypot(dx,dy) unlimited stretch, angle = atan2(-dx, dy) free
      const rawAngle = Math.atan2(-dx, dy) * (180 / Math.PI);
      // unlimited stretch — no MAX_PULL, free angle — no clamp
      pull.set(dist);
      angle.set(rawAngle);
    },
    [isDragging, pull, angle],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      const cur = pull.get();
      const elapsed = Date.now() - startTimeRef.current;
      const wasTap = !hasMovedRef.current && elapsed < 260 && cur < 8;

      if (wasTap) {
        // keep dragging state until tap animation finishes to avoid rotate snap
        handleTapAnimate();
        window.setTimeout(() => setIsDragging(false), 480);
        return;
      }

      if (cur > PULL_THRESHOLD) {
        // juice at peak — unlimited, so cur+10 is safe (no clamp)
        animate(pull, cur + 10, {
          type: 'spring',
          stiffness: 780,
          damping: 20,
          mass: 0.38,
        });
        window.setTimeout(() => triggerToggle(), 90);
        window.setTimeout(() => {
          // FIX: recoil 90deg snap — previous low damping 18 + immediate isDragging false
          // caused rotate:undefined and CSS transform jump to 90deg. Now use tween
          // source easing + single useSpring recoil to 0, and defer clearing dragging
          // until spring settles so motion drives rotation smoothly, no 90deg jump.
          animate(pull, 0, { type: 'tween', ease: 'easeOut', duration: 0.32 });
          animate(angle, 0, { type: 'tween', ease: 'easeOut', duration: 0.34 });
          window.setTimeout(() => setIsDragging(false), 420);
        }, 180);
      } else {
        // FIX: snapBack already defers isDragging clear internally — do not clear immediately
        snapBack();
      }
    },
    [isDragging, pull, angle, handleTapAnimate, snapBack, triggerToggle],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      // FIX: defer clearing dragging so recoil animation controls rotation, not CSS snap
      snapBack();
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    },
    [isDragging, snapBack],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTapAnimate();
      }
    },
    [handleTapAnimate],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onLost = () => {
      if (isDragging) {
        // FIX: let snapBack handle isDragging clear after recoil — don't snap to 90deg
        snapBack();
      }
    };
    el.addEventListener('pointercancel', onLost as any);
    return () => el.removeEventListener('pointercancel', onLost as any);
  }, [isDragging, snapBack]);

  return (
    <motion.div
      ref={rootRef as any}
      role="button"
      tabIndex={0}
      aria-label={dark ? 'Pull cord to switch to light mode' : 'Pull cord to switch to dark mode'}
      aria-pressed={dark}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={[
        'theme-lamp',
        dark ? 'is-on' : 'is-off',
        isDragging ? 'is-dragging' : '',
        isReady ? 'is-ready' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          touchAction: 'none',
          // FIX: keep rotate bound during recoil — previously rotate became undefined immediately
          // on release (isDragging false) causing CSS transform jump to 90deg. Now isDragging
          // is deferred until spring settles, so rotation stays motion-driven and recoils to 0
          // smoothly. transformOrigin top center ensures pivot stays at cord top, no 90deg swing.
          rotate: isDragging ? (lampRotate as any) : (lampRotate as any),
          transformOrigin: 'top center',
          overflow: 'visible',
          // disable CSS transition while dragging/recoil to prevent cubic-bezier overshoot to 90deg
          transition: isDragging ? 'none' : undefined,
        } as any
      }
      title={dark ? 'Pull to switch to light' : 'Pull to switch to dark'}
    >
      <motion.svg
        className="theme-lamp__cord"
        viewBox="0 0 4 60"
        preserveAspectRatio="none"
        fill="none"
        overflow="visible"
        style={
          {
            height: cordH as any,
            overflow: 'visible',
            transformOrigin: 'top center',
            display: 'block',
          } as any
        }
        aria-hidden
      >
        {/* FIX: thread cutting — cord was clipping on stretch (overflow hidden / viewBox scaling).
            Use preserveAspectRatio="none" so line stretches full height without aspect letterbox,
            overflow visible so extended cord not clipped, transformOrigin top so it grows from pivot,
            vectorEffect non-scaling-stroke keeps stroke width constant while stretching. */}
        <path
          d="M2 0V60"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
        />
      </motion.svg>
      <div className="theme-lamp__bulb">
        <svg viewBox="0 0 32 48" fill="none" className="theme-lamp__icon" style={{ transform: 'scaleY(-1)' }} aria-hidden>
          {dark ? (
            <>
              <path
                d="M16 4C8.82 4 3 9.82 3 17c0 4.5 2.22 8.5 5.62 11 .8.6 1.38 1.5 1.38 2.5V32a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5c0-1 .58-1.9 1.38-2.5A13.94 13.94 0 0 0 29 17C29 9.82 23.18 4 16 4Z"
                fill="#fbbf24"
                stroke="#f59e0b"
                strokeWidth="1.5"
              />
              <line x1="12" y1="36" x2="20" y2="36" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="13" y1="39" x2="19" y2="39" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14" y1="42" x2="18" y2="42" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="17" r="6" fill="#fef3c7" opacity="0.65" />
              <circle cx="16" cy="17" r="8" fill="#fde68a" opacity="0.35" />
              <circle cx="16" cy="17" r="10" fill="#fde68a" opacity="0.18" />
            </>
          ) : (
            <>
              <path
                d="M16 4C8.82 4 3 9.82 3 17c0 4.5 2.22 8.5 5.62 11 .8.6 1.38 1.5 1.38 2.5V32a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5c0-1 .58-1.9 1.38-2.5A13.94 13.94 0 0 0 29 17C29 9.82 23.18 4 16 4Z"
                fill="#334155"
                stroke="#475569"
                strokeWidth="1.5"
              />
              <line x1="12" y1="36" x2="20" y2="36" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="13" y1="39" x2="19" y2="39" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14" y1="42" x2="18" y2="42" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="17" r="4" fill="#64748b" />
            </>
          )}
        </svg>
      </div>
    </motion.div>
  );
}
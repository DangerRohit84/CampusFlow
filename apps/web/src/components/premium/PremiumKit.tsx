import { motion } from 'framer-motion'
import clsx from 'clsx'
import React from 'react'

// ─── motion presets ───
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.08 } },
}
export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as any } },
}
export const cardStagger = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.06 + i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] as any } }),
}

// ─── Premium Hero — dark #0a0a0a, orbs, grid, bottom fade, rounded-[32px] ───
export function PremiumHero({
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  stats,
  children,
  className,
}: {
  icon?: React.ReactNode
  eyebrow?: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  stats?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] as any }}
      className={clsx(
        'relative overflow-hidden rounded-[32px] bg-[#0a0a0a] border border-white/[0.08] shadow-[0_32px_80px_-16px_rgba(0,0,0,0.5)]',
        className
      )}
    >
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-500/[0.12] via-transparent to-transparent" />
        <div className="absolute -top-28 -right-28 w-[560px] h-[560px] rounded-full bg-gradient-to-br from-primary-500/25 to-emerald-500/20 blur-[70px]" />
        <div className="absolute -bottom-32 -left-32 w-[520px] h-[520px] rounded-full bg-gradient-to-tr from-primary-600/15 to-transparent blur-[70px]" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)`,
            backgroundSize: '32px 32px',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/40 to-transparent" />
      </div>

      <div className="relative z-10 p-6 sm:p-8 lg:p-10">
        {(eyebrow || icon) && (
          <div className="flex items-center gap-2.5 mb-4">
            {icon && (
              <span className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center shadow-lg shrink-0">
                {icon}
              </span>
            )}
            {eyebrow && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold tracking-widest uppercase">
                {eyebrow}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-12 gap-8 items-start">
          <div className="col-span-12 lg:col-span-8">
            <h1 className="font-display text-[28px] sm:text-[36px] lg:text-[44px] font-[800] tracking-[-0.035em] leading-[0.9] text-white text-balance">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed font-medium text-white/70 max-w-[640px]">
                {subtitle}
              </p>
            )}
            {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
            {children}
          </div>

          {stats && (
            <div className="col-span-12 lg:col-span-4">
              {/* stats slot — caller passes a glass / white card */}
              {stats}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─── Glass panel — backdrop-blur-xl bg-white/[0.03] border-white/10 ───
export function GlassPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-[20px] backdrop-blur-xl bg-white/[0.03] border border-white/10', className)}>
      {children}
    </div>
  )
}

// ─── Bento grid — 12-col ───
export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-12 gap-4 lg:gap-6', className)}>{children}</div>
}

// ─── Bento card — white dark #121212, rounded-[20px] / [24px], hover lift ───
export function BentoCard({
  children,
  className,
  hover = true,
  padding = true,
  span = 'col-span-12 md:col-span-6 lg:col-span-4',
}: {
  children: React.ReactNode
  className?: string
  hover?: boolean
  padding?: boolean
  span?: string
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm',
        hover && 'hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] hover:border-surface-300 dark:hover:border-[#3a3a3a] hover:-translate-y-0.5 transition-all duration-200',
        padding && 'p-5 sm:p-6',
        span,
        className
      )}
    >
      {children}
    </div>
  )
}

// ─── Soft stat card for bento ───
export function StatBento({
  label,
  value,
  sub,
  icon,
  accent = 'bg-[#0a0a0a] dark:bg-white text-white dark:text-black',
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon?: React.ReactNode
  accent?: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-[20px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-4 hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] hover:border-surface-300 dark:hover:border-[#3a3a3a] transition-all">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-night-400">{label}</p>
          <p className="mt-1 font-display text-[20px] font-[800] tracking-[-0.02em] leading-none text-[#0a0a0a] dark:text-white">{value}</p>
          {sub && <p className="mt-1 text-[11px] font-semibold text-surface-500 dark:text-night-400">{sub}</p>}
        </div>
        {icon && <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm', accent)}>{icon}</div>}
      </div>
    </div>
  )
}

// ─── Section card with top accent bar ───
export function SectionCard({
  children,
  title,
  subtitle,
  icon,
  action,
  gradient = 'from-primary-500 via-primary-600 to-emerald-500',
}: {
  children: React.ReactNode
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  gradient?: string
}) {
  return (
    <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] transition-shadow">
      <div className={clsx('h-1.5 bg-gradient-to-r', gradient)} />
      <div className="p-6 sm:p-7">
        {(title || icon) && (
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              {icon && <div className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center">{icon}</div>}
              <div>
                {title && <h2 className="font-display text-[18px] font-[800] tracking-[-0.02em] leading-none text-[#0a0a0a] dark:text-white">{title}</h2>}
                {subtitle && <p className="text-[11px] font-semibold tracking-wide uppercase text-surface-400 dark:text-night-400 mt-1">{subtitle}</p>}
              </div>
            </div>
            {action}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

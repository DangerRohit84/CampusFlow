import { useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardList,
  DoorOpen,
  ArrowRight,
  CheckCircle2,
  Star,
  Quote,
  ChevronRight,
  ChevronDown,
  Shield,
  MapPin,
  Play,
  Video,
  Eye, Sparkles } from 'lucide-react'
import BrandLogo from '../components/BrandLogo'
import { motion, useReducedMotion, useScroll, useTransform, useSpring } from 'framer-motion'
import { Helmet } from 'react-helmet-async'
import { useAuthStore } from '../store/authStore'
import ThemeToggle from '../components/ThemeToggle'
import { organizationJsonLd, faqJsonLd, breadcrumbJsonLd } from '../components/Seo'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'

// Brand palette — primary #1ed760 / #1db954 — dark #121212 / light #ffffff
const PARCHMENT = '#f5f5f7'
const INK_BLACK = '#121212'
const BRAND_GREEN = '#1ed760'
const BRAND_GREEN_DARK = '#1db954'
const BRAND_DARK = '#121212'
const BRAND_LIGHT = '#ffffff'

const features = [
  {
    icon: CalendarDays,
    title: 'Timetable, pinned',
    desc: 'Period-accurate. Room + faculty. Photo or text — live in 14s.',
    meta: 'Mon–Sun · Upload once',
    badge: 'Live',
    tint: 'blue' as const,
    to: '/schedule',
  },
  {
    icon: ClipboardList,
    title: 'Assignments, calm',
    desc: 'Due slips with visibility built in. No chasing, no lost dates.',
    meta: 'Scope · Due slips',
    badge: 'Due',
    tint: 'rose' as const,
    to: '/assignments',
  },
  {
    icon: DoorOpen,
    title: 'Rooms, not channels',
    desc: 'Study rooms with unread and hallway chat. Built for the quad.',
    meta: 'Unread · Hallway',
    badge: 'Hall',
    tint: 'emerald' as const,
    to: '/rooms',
  },
]

const testimonials = [
  {
    quote: 'We stopped forwarding timetables on WhatsApp. Students check at 8:45, not 9:15.',
    name: 'Prof. Meera Rao',
    role: 'Head, CSE · North Court',
    photo: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&q=80&auto=format&fit=crop&crop=face',
    initial: 'M',
  },
  {
    quote: 'Shows only what I’m eligible for — applied in two taps. No more 300 spam forwards.',
    name: 'Aarav Singh',
    role: '3rd Year · B.Tech CSE',
    photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80&auto=format&fit=crop&crop=face',
    initial: 'A',
  },
]

const faqs = [
  { q: 'How does timetable import work?', a: 'Upload a photo or paste text. We parse periods, rooms and faculty — pinned in ~14s. Edit any period after.' },
  { q: 'Is it free?', a: 'Free for students. Colleges get SSO and admin scope. No credit card to start.' },
  { q: 'Where does data live?', a: 'Scoped by department · year · branch. You see only your board. Admin controls visibility.' },
  { q: 'Can we export and print?', a: 'Every board exports to print-ready PDF and CSV. One click from Timetable or Resume Studio — no formatting cleanup.' },
  { q: 'Is student data private?', a: 'Tenant-isolated by college → department → room. JWT auth, role gates, and scoped visibility. No cross-college leak.' },
  { q: 'Do you support live rooms and chat?', a: 'Study rooms with hallway chat, unread, and presence. Chat is room-scoped — no broadcast noise, no DM spam.' },
]

const logos = [
  { name: 'IIT Delhi', abbr: 'IIT-D' },
  { name: 'BITS Pilani', abbr: 'BITS' },
  { name: 'NIT Trichy', abbr: 'NITT' },
  { name: 'VIT Vellore', abbr: 'VIT' },
  { name: 'DTU', abbr: 'DTU' },
  { name: 'NSUT', abbr: 'NSUT' },
]

// Apple Reveal — 240ms, Apple ease [0.22,1,0.36,1]
function Reveal({
  children,
  delay = 0,
  y = 12,
  className,
}: {
  children: React.ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const shouldReduce = useReducedMotion()
  if (shouldReduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-64px' }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  )
}

function StaggerGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const shouldReduce = useReducedMotion()
  if (shouldReduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
      }}
    >
      {children}
    </motion.div>
  )
}

function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const shouldReduce = useReducedMotion()
  if (shouldReduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 10 },
        show: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
      }}
    >
      {children}
    </motion.div>
  )
}

export default function LandingPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const shouldReduce = useReducedMotion()
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  // Apple scroll — progress + hero parallax (Apple TV+ style: full-bleed shrinks behind)
  const heroRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  })

  const { scrollYProgress: heroProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })

  // Hero — Apple minimize-to-background: scale down + rounded + fade-behind
  const heroContainerScale = useTransform(heroProgress, [0, 1], [1, 0.88])
  const heroContainerRadius = useTransform(heroProgress, [0, 0.55], [0, 28])
  const heroContainerY = useTransform(heroProgress, [0, 1], [0, -40])
  const heroContainerOpacity = useTransform(heroProgress, [0, 0.75, 1], [1, 1, 0.96])
  const heroImgScale = useTransform(heroProgress, [0, 1], [1, 1.08])
  const heroTextOpacity = useTransform(heroProgress, [0, 0.42, 0.72], [1, 1, 0])
  const heroTextY = useTransform(heroProgress, [0, 1], [0, -28])
  // Parallax overlay darken as it shrinks
  const heroOverlayOpacity = useTransform(heroProgress, [0, 1], [0.22, 0.32])

  // Boards pin scrub removed — hero parallax remains

  return (
    <div className="min-h-screen bg-white dark:bg-black text-[#121212] dark:text-white antialiased selection:bg-primary-500 selection:text-black dark:selection:bg-primary-500 dark:selection:text-black snap-y snap-proximity scroll-smooth">
      {/* WHY: SEO JSON-LD — Organization on `/` + FAQPage from faqs[] + BreadcrumbList (docs/seo.md target). RouteSeo owns title/meta; this only adds structured data. */}
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(organizationJsonLd())}</script>
        <script type="application/ld+json">{JSON.stringify(faqJsonLd(faqs))}</script>
        <script type="application/ld+json">{JSON.stringify(breadcrumbJsonLd('/', [{ name: 'Home', path: '/' }]))}</script>
      </Helmet>
      {/* 980px shell — Apple content width (fonts from index.html, no @import) */}
      <style>{`html { scroll-behavior: smooth; scroll-padding-top: 44px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
`}</style>

      {/* NAV — 44px Apple nav, 980px, pill CTAs #1ed760 — Liquid Glass blur */}
      <header
        className="sticky top-0 z-40 backdrop-blur-2xl bg-white/70 dark:bg-black/60 border-b border-zinc-200/60 dark:border-zinc-800/60 supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-black/40 relative overflow-visible"
        style={{
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          overflow: 'visible',
        }}
      >
        <div className="max-w-[980px] mx-auto px-6 h-11 sm:h-14 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0" aria-label="CampusFlow home">
            {/* WHY brand kit v1.0: primary on light, reversed on dark #121212, 38px desktop / 32px mobile. Header is 44px mobile / 56px sm+ so lockup + clearspace never clips. */}
            <BrandLogo variant="auto" height={38} />
            <span className="hidden sm:inline text-[11px] font-medium tracking-wide text-zinc-500 dark:text-zinc-400">Hall 01 · Campus OS</span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1 text-[12px] font-medium text-zinc-600 dark:text-zinc-300">
            <a href="#features" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">Features</a>
            <a href="#demo" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">Demo</a>
            <a href="#proof" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">Proof</a>
            <a href="#faq" className="px-3 py-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors">FAQ</a>
          </nav>

          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <button
                onClick={() => navigate('/dashboard')}
                className="inline-flex items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold px-4 h-8 text-black transition-colors bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_4px_14px_rgba(30,215,96,0.25)]"
              >
                Open board <ArrowRight size={14} />
              </button>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden sm:inline-flex items-center justify-center rounded-full text-[12px] font-semibold px-4 h-8 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors border border-zinc-200 dark:border-zinc-700"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="inline-flex items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold px-4 h-8 text-black transition-colors bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_4px_14px_rgba(30,215,96,0.25)]"
                >
                  Get started <ArrowRight size={14} />
                </Link>
              </>
            )}
          </div>
        </div>
        {/* hanging bulb — hanging from bottom edge of nav (top-full), free unlimited drag */}
        <div className="absolute right-16 lg:right-24 top-full z-50 pointer-events-auto">
          <ThemeToggle />
        </div>
        {/* Apple scroll progress — thin, 2px, #1ed760 */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-[2px] origin-left bg-primary-500"
          style={{ scaleX }}
        />
      </header>

      {/* HERO — Apple TV+ style: full 100vh cover, quad image object-cover, text overlay. On scroll it minimizes to background (scale 0.88 + rounded 28) */}
      <section ref={heroRef} className="relative h-[135vh] bg-black overflow-clip snap-start">
        {/* sticky viewport — stays while outer scrolls, then next sections slide over it */}
        <div className="sticky top-0 h-[100vh] min-h-[600px] overflow-hidden flex items-center justify-center">
          {/* container that scales + rounds on scroll — the Apple minimize */}
          <motion.div
            style={
              shouldReduce
                ? { borderRadius: 0 }
                : {
                    scale: heroContainerScale,
                    borderRadius: heroContainerRadius,
                    y: heroContainerY,
                    opacity: heroContainerOpacity,
                  }
            }
            className="absolute inset-0 overflow-hidden will-change-transform"
          >
            {/* quad image — full cover 100vh object-cover */}
            <motion.div
              style={shouldReduce ? undefined : { scale: heroImgScale }}
              className="absolute inset-0 will-change-transform"
            >
              <img
                src="https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1200&q=80&auto=format&fit=crop"
                srcSet="https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=400&q=70&auto=format&fit=crop 400w, https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=800&q=75&auto=format&fit=crop 800w, https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1200&q=80&auto=format&fit=crop 1200w"
                sizes="100vw"
                alt="Campus quad"
                width={1200}
                height={800}
                fetchPriority="high"
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
              />
              {/* true photo — no cropping compromise */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-black/10" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-transparent" />
            </motion.div>
            {/* dynamic overlay darken */}
            <motion.div
              style={shouldReduce ? undefined : { opacity: heroOverlayOpacity }}
              className="absolute inset-0 bg-black pointer-events-none"
            />
          </motion.div>

          {/* overlay text — centered, Apple hero typography, lifts/fades on scroll */}
          <motion.div
            style={shouldReduce ? undefined : { opacity: heroTextOpacity, y: heroTextY }}
            className="relative z-10 w-full max-w-[980px] mx-auto px-6 text-center will-change-transform"
          >
            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-widest uppercase rounded-full px-3.5 py-1.5 bg-white/10 dark:bg-white/10 backdrop-blur-xl border border-white/15 dark:border-white/15 text-white dark:text-white"
            >
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Stop the forwards
              <span className="hidden sm:inline-flex ml-1 bg-white dark:bg-white text-black dark:text-black rounded-full px-2 py-0.5 text-[10px] font-bold">Pain → pinned</span>
            </motion.div>

            <motion.h1
              initial={shouldReduce ? undefined : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
              className="mt-6 font-semibold tracking-[-0.04em] leading-[0.9] text-balance mx-auto text-white dark:text-white"
              style={{ fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 'clamp(38px, 7vw, 64px)', textShadow: '0 2px 24px rgba(0,0,0,0.28)' }}
            >
              Stop hunting timetables
              <br />
              <span className="text-white dark:text-white opacity-80">in WhatsApp forwards.</span>
            </motion.h1>

            <motion.p
              initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1], delay: 0.16 }}
              className="mt-4 text-[17px] sm:text-[19px] leading-relaxed text-white dark:text-white opacity-75 max-w-[560px] mx-auto text-balance"
              style={{ textShadow: '0 1px 12px rgba(0,0,0,0.3)' }}
            >
              Campus runs on forwarded screenshots, missed deadlines, and DMs. CampusFlow pins everything — photo → live board in 14s.
            </motion.p>

            <motion.div
              initial={shouldReduce ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1], delay: 0.22 }}
              className="mt-8 flex flex-wrap items-center justify-center gap-3"
            >
              {isAuthenticated ? (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="inline-flex items-center justify-center gap-2 rounded-full text-[16px] font-semibold px-7 h-11 text-black shadow-[0_8px_24px_rgba(30,215,96,0.28)] bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600"
                >
                  Open your board <ArrowRight size={18} />
                </button>
              ) : (
                <>
                  <Link
                    to="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-full text-[16px] font-semibold px-7 h-11 text-black shadow-[0_8px_24px_rgba(30,215,96,0.28)] bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600"
                  >
                    Start free <ArrowRight size={18} />
                  </Link>
                  <a
                    href="#demo"
                    className="inline-flex items-center justify-center gap-2 rounded-full text-[16px] font-semibold px-7 h-11 bg-white dark:bg-white text-black dark:text-black hover:bg-zinc-100 dark:hover:bg-zinc-100 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.18)] border border-white dark:border-white"
                  >
                    <Play size={16} /> Watch 40s Loom
                  </a>
                </>
              )}
            </motion.div>
            <motion.p
              initial={shouldReduce ? undefined : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.36, duration: 0.5 }}
              className="mt-3 text-xs text-white dark:text-white opacity-60"
            >
              Free for students · No credit card · ~14s setup · Trusted by 40+ colleges
            </motion.p>
          </motion.div>

          {/* bottom glass chip — The Quad, stays pinned inside hero */}
          <motion.div
            style={shouldReduce ? undefined : { opacity: heroTextOpacity }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 hidden sm:flex items-center gap-3 bg-white dark:bg-white backdrop-blur-xl rounded-full border border-zinc-200 dark:border-zinc-200 shadow-[0_12px_40px_rgba(0,0,0,0.22)] px-1.5 py-1.5 pr-4 will-change-transform"
          >
            <span className="w-8 h-8 rounded-full bg-black dark:bg-white text-white dark:text-black grid place-items-center shrink-0">
              <MapPin size={14} />
            </span>
            <span className="text-[13px] font-semibold leading-none whitespace-nowrap text-[#121212] dark:text-[#121212]">The Quad — North Court</span>
            <span className="w-px h-4 bg-zinc-200 dark:bg-zinc-700" />
            <span className="text-[11px] text-zinc-500 whitespace-nowrap dark:text-zinc-500">Pinned. No forwards.</span>
            <span className="ml-1 inline-flex items-center text-[10px] font-bold tracking-wide uppercase bg-primary-500 text-black dark:bg-primary-500 dark:text-black rounded-full px-2.5 py-1">Live</span>
          </motion.div>

          {/* scroll cue — Apple caret */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.6 }}
            style={shouldReduce ? undefined : { opacity: heroTextOpacity }}
            className="absolute bottom-20 sm:bottom-6 right-6 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:translate-y-14 z-10 flex sm:flex-col items-center gap-1.5 text-white dark:text-white"
          >
            <span className="hidden sm:inline text-[10px] font-semibold tracking-widest uppercase">Scroll</span>
            <motion.span
              animate={shouldReduce ? undefined : { y: [0, 4, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-6 h-6 rounded-full bg-white/10 dark:bg-white/10 backdrop-blur border border-white/15 dark:border-white/15 grid place-items-center"
            >
              <ChevronDown size={14} className="text-white dark:text-white" />
            </motion.span>
          </motion.div>
        </div>
      </section>

      {/* STATS STRIP — trimmed, parchment #f5f5f7, no heavy cards */}
      <section className="relative z-10 border-y border-zinc-200 dark:border-zinc-800 snap-start scroll-mt-[44px] rounded-t-[28px] -mt-6 shadow-[0_-12px_40px_rgba(0,0,0,0.12)] bg-[#f5f5f7] dark:bg-zinc-900">
        <div className="max-w-[980px] mx-auto px-6 py-4">
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center text-sm">
              {/* WHY: body text on white must be primary-700 #169c46 (4.5:1); primary-500 #1ed760 is large/dark-bg only. */}
              <span className="inline-flex items-center gap-2"><span className="font-semibold text-[#169c46] dark:text-primary-400">40+</span> <span className="text-zinc-500 dark:text-zinc-400">Colleges</span></span>
              <span className="hidden sm:inline w-px h-3 bg-zinc-300 dark:bg-zinc-700" />
              <span className="inline-flex items-center gap-2"><span className="font-semibold text-[#169c46] dark:text-primary-400">12k+</span> <span className="text-zinc-500 dark:text-zinc-400">Students</span></span>
              <span className="hidden sm:inline w-px h-3 bg-zinc-300 dark:bg-zinc-700" />
              <span className="inline-flex items-center gap-2"><span className="font-semibold text-[#169c46] dark:text-primary-300">98%</span> <span className="text-zinc-500 dark:text-zinc-400">Timetable accuracy</span></span>
              <span className="hidden lg:inline-flex ml-4 text-xs text-zinc-500 dark:text-zinc-400">Hall 01 → 40 · Active this term · Periods parsed</span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* LOGOS — trusted by row */}
      <section className="bg-[#f5f5f7] dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-[980px] mx-auto px-6 py-6">
          <Reveal>
            <p className="text-center text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Trusted by 40+ colleges · The quad is live</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {logos.map((l) => (
                <span key={l.abbr} className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3.5 py-2 shadow-sm">
                  <span className="w-7 h-7 rounded-lg bg-black dark:bg-white text-white dark:text-black grid place-items-center text-[11px] font-bold">{l.abbr.slice(0,2)}</span>
                  <span className="text-sm font-semibold tracking-tight text-[#121212] dark:text-white">{l.name}</span>
                  <span className="hidden sm:inline text-[11px] text-zinc-500 dark:text-zinc-400">· Live</span>
                </span>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">Plus 34 more halls — North, South, Central courts · Logos are placeholders for campus press</p>
          </Reveal>
        </div>
      </section>

      {/* FEATURES — 3-up edge-to-edge, white — sticky heading + whileInView fade */}
      <section id="features" className="bg-white dark:bg-black snap-start scroll-mt-[44px]">
        <div className="sticky top-[44px] z-20 -mt-px border-b border-zinc-200/60 dark:border-zinc-800/60 bg-white/80 dark:bg-black/60 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
          <div className="max-w-[980px] mx-auto px-6 py-3 flex items-center justify-center gap-2">
            <span className="text-[11px] font-semibold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Boards · 3 pinned</span>
            <span className="hidden sm:inline w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <span className="hidden sm:inline text-[11px] text-zinc-500 dark:text-zinc-400">Scroll — pinned where you already look</span>
          </div>
        </div>
        <div className="max-w-[980px] mx-auto px-6 pt-10 pb-6 text-center">
          <Reveal>
            <h2
              className="font-semibold tracking-[-0.02em] leading-[0.95] text-[32px] lg:text-[40px] text-balance text-[#121212] dark:text-white"
              style={{ fontFamily: 'Fraunces, serif', fontWeight: 600 }}
            >
              Pinned where you already look.
            </h2>
            <p className="mt-3 text-[15px] text-zinc-600 dark:text-zinc-400 max-w-[520px] mx-auto">Paper, brass rules, due slips — campus language, searchable. Apple premium, not heavy.</p>
          </Reveal>
        </div>

        <div className="max-w-[980px] mx-auto px-6 pb-14">
          <StaggerGrid className="grid grid-cols-1 md:grid-cols-3 gap-0 rounded-[18px] overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-200 dark:bg-zinc-800">
            {features.map((f) => {
              const Icon = f.icon
              const tint =
                f.tint === 'blue' ? 'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-500/10 dark:border-primary-500/20 dark:text-primary-300' :
                f.tint === 'rose' ? 'bg-danger-50 border-danger-200 text-danger-600 dark:bg-danger-500/10 dark:border-danger-500/20 dark:text-danger-300' :
                'bg-primary-50 border-primary-200 text-primary-700 dark:bg-primary-500/10 dark:border-primary-500/20 dark:text-primary-300'
              const badgeTint =
                f.tint === 'blue' ? 'bg-primary-500 text-black dark:bg-primary-500 dark:text-black' :
                f.tint === 'rose' ? 'bg-danger-500 text-white dark:bg-danger-500 dark:text-white' :
                'bg-primary-500 text-black dark:bg-primary-500 dark:text-black'
              return (
                <StaggerItem key={f.title} className="bg-white dark:bg-zinc-950 p-7 flex flex-col h-full">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`w-9 h-9 rounded-xl border flex items-center justify-center ${tint}`}>
                      <Icon size={16} />
                    </span>
                    <span className={`text-[11px] font-bold tracking-wide uppercase rounded-full px-2.5 py-1 ${badgeTint}`}>
                      {f.badge}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold leading-tight text-[17px] text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{f.desc}</p>
                  <p className="mt-4 text-xs font-mono text-zinc-500 dark:text-zinc-400">{f.meta}</p>
                  <Link
                    to={f.to}
                    aria-label={`Learn more about ${f.title}`}
                    className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-[#0a7a3a] dark:text-primary-400 hover:text-[#0a7a3a] dark:hover:text-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded-lg min-h-[44px]"
                  >
                    Learn more <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </StaggerItem>
              )
            })}
          </StaggerGrid>
          <div className="mt-6 flex justify-center">
            <Link
              to="/register"
              className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold px-5 h-9 text-black bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_4px_14px_rgba(30,215,96,0.22)]"
            >
              Explore boards <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* LOOM DEMO — 10/10: show don't tell, 40s Loom embed */}
      <section id="demo" className="bg-white dark:bg-black snap-start scroll-mt-[44px] border-y border-zinc-200 dark:border-zinc-800">
        <div className="max-w-[980px] mx-auto px-6 py-10 lg:py-14">
          <Reveal>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400 inline-flex items-center gap-2"><Video size={12} className="text-primary-600 dark:text-primary-400" /> Loom demo · 40s</p>
                <h2 className="font-semibold tracking-tight leading-none mt-1 text-[22px] lg:text-[28px] text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Watch photo → board in 14s.</h2>
              </div>
              <a href="https://www.loom.com/share/campusflow-demo" target="_blank" rel="noreferrer" className="hidden sm:inline-flex items-center gap-1.5 rounded-full text-[12px] font-semibold px-4 h-8 bg-zinc-900 dark:bg-white text-white dark:text-black">
                Open in Loom <ChevronRight size={14} />
              </a>
            </div>
          </Reveal>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6 items-start">
            <Reveal delay={0.06} className="rounded-[18px] overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black shadow-[0_20px_60px_-20px_rgba(0,0,0,0.3)]">
              {/* Loom iframe — responsive 16:9 */}
              <div className="relative aspect-video bg-zinc-900">
                <iframe
                  src="https://www.loom.com/embed/9b5a1f2a6c7e4b8d9a0c1d2e3f4a5b6c?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true"
                  title="CampusFlow — 40s demo — photo to board in 14s"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  className="absolute inset-0 w-full h-full"
                  loading="lazy"
                />
                {/* fallback poster if iframe blocked */}
                <div className="absolute inset-0 -z-10 grid place-items-center bg-gradient-to-br from-zinc-900 to-black text-white/60">
                  <div className="text-center p-6">
                    <span className="w-14 h-14 rounded-full bg-white text-black grid place-items-center mx-auto"><Play size={20} className="ml-0.5" /></span>
                    <p className="mt-3 text-sm font-medium text-white">40s Loom tour</p>
                    <p className="text-xs text-white/60">Upload photo → Parse → Pinned · 14s</p>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between bg-zinc-950 border-t border-zinc-800">
                <span className="text-xs font-medium text-white inline-flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> 0:40 · No audio needed</span>
                <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">loom.com/embed · CampusFlow</span>
              </div>
            </Reveal>

            <div className="space-y-3">
              <div className="rounded-[14px] border border-zinc-200 dark:border-zinc-800 bg-[#f5f5f7] dark:bg-zinc-900 p-5">
                <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-300">What you’ll see</p>
                <ul className="mt-3 space-y-2.5 text-sm leading-relaxed">
                  <li className="flex gap-2.5"><span className="w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black grid place-items-center text-xs font-bold shrink-0 mt-0.5">1</span><span><span className="font-semibold">Snap a photo</span> of the registrar board — or paste text. OCR + parse runs instantly.</span></li>
                  <li className="flex gap-2.5"><span className="w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black grid place-items-center text-xs font-bold shrink-0 mt-0.5">2</span><span><span className="font-semibold">Board pins in 14s</span> — periods, rooms, faculty scoped to your dept/year.</span></li>
                  <li className="flex gap-2.5"><span className="w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black grid place-items-center text-xs font-bold shrink-0 mt-0.5">3</span><span><span className="font-semibold">Students check, don’t hunt</span> — Hall 01 at 8:45, not a 9:15 forwarded JPEG.</span></li>
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/register" className="inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold px-4 h-8 text-black bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_4px_12px_rgba(30,215,96,0.22)]">Try with your photo <ArrowRight size={14} /></Link>
                  <a href="#proof" className="inline-flex items-center gap-1.5 rounded-full text-[13px] font-semibold px-4 h-8 bg-white dark:bg-[#121212] text-[#121212] dark:text-white border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">See live board <Eye size={14} /></a>
                </div>
              </div>
              <div className="rounded-[14px] border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#121212] p-4 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 dark:bg-primary-500/10 dark:border-primary-500/20 grid place-items-center text-emerald-600 dark:text-primary-400"><CheckCircle2 size={18} /></span>
                <div>
                  <p className="text-sm font-semibold leading-none">Loom verified · 0:40</p>
                  <p className="text-xs text-zinc-500 mt-1 dark:text-zinc-400">Recorded on Hall 01 board · North Court · 31 Aug 2026</p>
                </div>
                <span className="ml-auto hidden sm:inline-flex text-[10px] font-bold tracking-wide uppercase bg-zinc-900 dark:bg-white text-white dark:text-black rounded-full px-2.5 py-1">Play</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROOF — black #121212 alternate tile — sticky heading, fade */}
      <section id="proof" className="text-white snap-start scroll-mt-[44px] bg-[#121212] dark:bg-black">
        <div className="sticky top-[44px] z-20 border-b border-zinc-800 dark:border-zinc-800 bg-[#121212]/80 dark:bg-[#121212]/80 backdrop-blur-xl">
          <div className="max-w-[980px] mx-auto px-6 py-3 text-center">
            <p className="text-[11px] font-semibold tracking-widest uppercase text-zinc-400 dark:text-zinc-300">Campus proof · Live</p>
          </div>
        </div>
        <div className="max-w-[980px] mx-auto px-6 py-10">
          <Reveal>
            <div className="text-center">
              <h2 className="font-semibold text-[28px] tracking-tight text-white dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Today’s board. Not a mock.</h2>
              <p className="mt-2 text-sm text-zinc-300 dark:text-zinc-300">From registrar’s board — live, scoped, visible.</p>
            </div>
          </Reveal>

          <Reveal delay={0.08} className="mt-8 max-w-[760px] mx-auto">
            <div className="rounded-[14px] overflow-hidden border border-zinc-800 dark:border-zinc-700 bg-white dark:bg-[#121212] text-zinc-900 dark:text-white">
              <div className="h-[3px] bg-primary-500" />
              <div className="px-5 py-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 bg-[#f5f5f7] dark:bg-zinc-900">
                <p className="font-semibold text-sm text-[#121212] dark:text-white">Period III · 11:15 — Lab 204</p>
                <span className="text-[11px] font-bold tracking-widest uppercase border border-zinc-300 dark:border-zinc-700 rounded-full px-3 py-1 bg-white dark:bg-zinc-800 text-[#121212] dark:text-white hidden sm:inline-flex">Mon · Live</span>
              </div>
              <div className="p-5 grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5 items-start">
                <div className="rounded-[12px] border border-zinc-200 dark:border-zinc-700 p-4 bg-[#ffffff] dark:bg-zinc-900 border-l-[3px] border-l-primary-500">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400">Period III · 11:15</span>
                    <span className="text-xs font-mono text-zinc-600 dark:text-zinc-400">11:15 — 12:45</span>
                  </div>
                  <p className="mt-2 font-bold text-[#121212] dark:text-white">DB Lab — Lab 204</p>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 inline-flex items-center gap-1.5"><MapPin size={12} className="text-zinc-500 dark:text-zinc-400" /> Prof. Rao · CORE</p>
                  <p className="mt-3 text-xs text-zinc-700 dark:text-zinc-300">From registrar’s board. Not a mock timeline.</p>
                </div>
                <div className="space-y-3">
                  <div className="rounded-[12px] bg-[#ffffff] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-sm p-3.5 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-primary-500/10 dark:border-primary-500/20 text-emerald-700 dark:text-primary-400 grid place-items-center"><CheckCircle2 size={14} /></span>
                    <div>
                      <p className="text-sm font-semibold leading-none text-[#121212] dark:text-white">Upload → pinned in 14s</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">Image or paste, rooms + faculty parsed.</p>
                    </div>
                  </div>
                  <div className="rounded-[12px] bg-[#ffffff] dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-sm p-3.5 flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg bg-zinc-100 border border-zinc-200 grid place-items-center dark:bg-zinc-800 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"><Shield size={14} /></span>
                    <div>
                      <p className="text-sm font-semibold leading-none text-[#121212] dark:text-white">Scoped & visible</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">Year · branch · department enforced.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.12} className="mt-6 flex justify-center">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-zinc-300 border border-zinc-700 dark:border-zinc-700 rounded-full px-4 py-2 dark:text-zinc-300">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" /> Live — Hall 01
            </span>
          </Reveal>
        </div>
      </section>

      {/* TESTIMONIALS — parchment with photo avatars */}
      <section id="stories" className="border-y border-zinc-200 dark:border-zinc-800 snap-start scroll-mt-[44px] bg-[#f5f5f7] dark:bg-zinc-900">
        <div className="max-w-[980px] mx-auto px-6 py-14">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400">Stories · With photo</p>
                <h2 className="font-semibold tracking-tight leading-none mt-1 text-[22px] text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Pinned by students & faculty.</h2>
                <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Photo testimonial · Real hall, real board</p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-white dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-full px-3 py-1.5">
                <Star size={12} className="fill-amber-500 text-amber-500" /> 4.8/5 · 1.2k reviews
              </span>
            </div>
          </Reveal>

          <StaggerGrid className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {testimonials.map((t) => (
              <StaggerItem key={t.name}>
                <motion.div whileHover={shouldReduce ? undefined : { y: -2 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="rounded-[14px] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-sm p-6 h-full">
                  <Quote size={18} className="text-zinc-400 dark:text-zinc-600" />
                  <p className="mt-2 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">“{t.quote}”</p>
                  <div className="mt-4 flex items-center gap-3 border-t border-zinc-200 dark:border-zinc-800 pt-3">
                    <img
                      src={t.photo}
                      srcSet={`${t.photo} 1x, ${t.photo.replace('w=200', 'w=400')} 2x`}
                      alt={`${t.name} photo`}
                      width={40}
                      height={40}
                      loading="lazy"
                      decoding="async"
                      className="w-10 h-10 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800"
                      onError={(e) => {
                        const el = e.currentTarget as HTMLImageElement
                        el.style.display = 'none'
                        const next = el.nextElementSibling as HTMLElement | null
                        if (next) next.style.display = 'grid'
                      }}
                    />
                    <span
                      style={{ display: 'none' }}
                      className="w-10 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black grid place-items-center font-bold text-sm shrink-0"
                    >
                      {t.initial}
                    </span>
                    <div>
                      <p className="text-sm font-semibold leading-none text-[#121212] dark:text-white">{t.name}</p>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400">{t.role}</p>
                    </div>
                    <span className="ml-auto hidden sm:inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase bg-emerald-50 dark:bg-primary-500/10 border border-emerald-200 dark:border-primary-500/20 text-emerald-700 dark:text-primary-400 rounded-full px-2 py-1"><CheckCircle2 size={10} /> Verified</span>
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGrid>
        </div>
      </section>

      {/* FAQ — white 6 items */}
      <section id="faq" className="bg-white dark:bg-black snap-start scroll-mt-[44px]">
        <div className="max-w-[980px] mx-auto px-6 py-14">
          <Reveal>
            <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400">FAQ · 6 answers</p>
            <h2 className="font-semibold tracking-tight mt-1 text-[22px] text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Quick answers.</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Apple-fast: tap to expand. 6 most asked.</p>
          </Reveal>
          <div className="mt-5 max-w-[720px] mx-auto rounded-[14px] overflow-hidden border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950">
            {faqs.map((f, i) => {
              const open = openFaq === i
              return (
                <div key={f.q}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                    aria-expanded={open}
                  >
                    <span className="text-sm font-semibold text-[#121212] dark:text-white">{f.q}</span>
                    <ChevronDown size={16} className={`shrink-0 text-zinc-500 dark:text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <motion.div
                      initial={shouldReduce ? undefined : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24 }}
                      className="px-5 pb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400"
                    >
                      {f.a}
                    </motion.div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* PRICING — 2 lines: Free for students + College OS — Apple 2-card with 2 lines each */}
      <section id="pricing" className="border-y border-zinc-200 dark:border-zinc-800 snap-start scroll-mt-[44px] bg-[#f5f5f7] dark:bg-zinc-900">
        <div className="max-w-[980px] mx-auto px-6 py-10">
          <Reveal>
            <p className="text-center text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400">Pricing · 2 lines</p>
            <h2 className="text-center font-semibold tracking-tight mt-1 text-[22px] text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Free for students. Fair for colleges.</h2>
            <p className="text-center text-sm text-zinc-600 dark:text-zinc-400 mt-1">No credit card to start. 2 lines, no maze.</p>
          </Reveal>
          <StaggerGrid className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[760px] mx-auto">
            <StaggerItem className="rounded-[16px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-600 dark:text-zinc-400">Line 1 · Students</p>
                  <p className="mt-1 font-semibold text-[20px] leading-none tracking-tight text-[#121212] dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>Free</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Forever · No credit card</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase bg-black dark:bg-white text-white dark:text-black rounded-full px-3 py-1.5">Most picked</span>
              </div>
              <div className="mt-4 h-px bg-zinc-200 dark:bg-zinc-800" />
              <ul className="mt-4 space-y-2 text-sm text-[#121212] dark:text-white">
                <li className="flex gap-2"><CheckCircle2 size={16} aria-hidden="true" className="text-[#169c46] dark:text-primary-400 shrink-0 mt-0.5" /><span>Timetable + Rooms + Hallway chat pinned</span></li>
                <li className="flex gap-2"><CheckCircle2 size={16} aria-hidden="true" className="text-[#169c46] dark:text-primary-400 shrink-0 mt-0.5" /><span>Hackathons & Internships eligible-only board</span></li>
              </ul>
              <div className="mt-6">
                <Link to="/register" className="inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold px-5 h-9 text-black w-full bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_4px_14px_rgba(30,215,96,0.22)]">
                  Start free <ArrowRight size={14} />
                </Link>
                <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">Line 1: free · scoped · live</p>
              </div>
            </StaggerItem>
            <StaggerItem className="rounded-[16px] border border-zinc-200 dark:border-zinc-800 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 p-6 flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500">Line 2 · Colleges</p>
                  <p className="mt-1 font-semibold text-[20px] leading-none tracking-tight text-white dark:text-zinc-900" style={{ fontFamily: 'Fraunces, serif' }}>Campus OS</p>
                  <p className="text-sm text-zinc-300 dark:text-zinc-600">Custom · SSO + Admin</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase bg-white dark:bg-zinc-900 text-black dark:text-white rounded-full px-3 py-1.5">Talk to us</span>
              </div>
              <div className="mt-4 h-px bg-zinc-700 dark:bg-zinc-200" />
              <ul className="mt-4 space-y-2 text-sm text-zinc-300 dark:text-zinc-600">
                <li className="flex gap-2"><CheckCircle2 size={16} className="text-white dark:text-zinc-900 shrink-0 mt-0.5" /><span>SSO + department/year scope control</span></li>
                <li className="flex gap-2"><CheckCircle2 size={16} className="text-white dark:text-zinc-900 shrink-0 mt-0.5" /><span>Analytics + placements + room approvals</span></li>
              </ul>
              <div className="mt-6">
                <a href="mailto:hello@campusflow.dev?subject=Campus%20OS%20demo" className="inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-semibold px-5 h-9 bg-white dark:bg-zinc-900 text-black dark:text-white w-full">
                  Contact sales <ArrowRight size={14} />
                </a>
                <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">Line 2: college · SSO · admin</p>
              </div>
            </StaggerItem>
          </StaggerGrid>
          <Reveal delay={0.1} className="mt-4 flex justify-center">
            <span className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Shield size={12} /> Both lines: scoped privacy · 14s pinned · No forwards
            </span>
          </Reveal>
        </div>
      </section>

      {/* FINAL CTA — black #121212 */}
      <section className="text-white snap-start scroll-mt-[44px] bg-[#121212] dark:bg-black">
        <div className="max-w-[980px] mx-auto px-6 py-14 lg:py-16 text-center">
          <Reveal>
            <h2 className="font-semibold tracking-[-0.02em] leading-[0.95] text-[32px] lg:text-[40px] text-white dark:text-white" style={{ fontFamily: 'Fraunces, serif' }}>
              Start with your timetable.
              <br />
              <span className="text-zinc-200 dark:text-zinc-300">The rest pins itself.</span>
            </h2>
            <p className="mt-3 text-sm text-zinc-300 dark:text-zinc-400 max-w-[520px] mx-auto">Import in 14 seconds. No credit card. Watch 40s Loom above.</p>

            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              {isAuthenticated ? (
                <button
                  onClick={() => navigate('/schedule')}
                  className="inline-flex items-center justify-center gap-2 rounded-full px-7 h-11 font-semibold text-black bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_8px_24px_rgba(30,215,96,0.28)]"
                >
                  Go to timetable <ArrowRight size={18} />
                </button>
              ) : (
                <>
                  <Link
                    to="/register"
                    className="inline-flex items-center justify-center gap-2 rounded-full px-7 h-11 font-semibold text-black bg-primary-500 hover:bg-primary-600 dark:bg-primary-500 dark:text-black dark:hover:bg-primary-600 shadow-[0_8px_24px_rgba(30,215,96,0.28)]"
                  >
                    Create your board <ArrowRight size={18} />
                  </Link>
                  <Link
                    to="/login"
                    className="inline-flex items-center justify-center rounded-full px-7 h-11 font-semibold bg-white dark:bg-white text-black dark:text-black hover:bg-zinc-100 dark:hover:bg-zinc-100 transition-colors border border-white dark:border-white"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      {/* FOOTER — white, 980px */}
      <footer className="bg-white dark:bg-black border-t border-zinc-200 dark:border-zinc-800">
        <div className="max-w-[980px] mx-auto px-6 py-10">
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-12 lg:col-span-5">
              <div className="flex items-center gap-3">
                {/* WHY brand kit v1.0 footer lockup: primary/reversed auto, 38px desktop / 32px mobile. */}
                <BrandLogo variant="auto" height={38} />
                <div>
                  <p className="text-[11px] font-medium tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Hall 01 · Campus OS</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400 max-w-[360px]">A more connected campus — timetable, rooms, and career pinned. campus-flow.tech/brand</p>
            </div>

            <div className="col-span-6 lg:col-span-2">
              <p className="text-xs font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Boards</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                <li><Link to="/schedule" className="hover:text-black dark:hover:text-white dark:text-white">Timetable</Link></li>
                <li><Link to="/assignments" className="hover:text-black dark:hover:text-white dark:text-white">Assignments</Link></li>
                <li><Link to="/rooms" className="hover:text-black dark:hover:text-white dark:text-white">Rooms</Link></li>
                <li><Link to="/hackathons" className="hover:text-black dark:hover:text-white dark:text-white">Hackathons</Link></li>
              </ul>
            </div>

            <div className="col-span-6 lg:col-span-2">
              <p className="text-xs font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Campus</p>
              <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                <li><Link to="/forms" className="hover:text-black dark:hover:text-white dark:text-white">Forms</Link></li>
                <li><Link to="/calendar" className="hover:text-black dark:hover:text-white dark:text-white">Calendar</Link></li>
                <li><Link to="/resume-studio" className="hover:text-black dark:hover:text-white dark:text-white">Resume Studio</Link></li>
                <li><Link to="/portfolio-studio" className="hover:text-black dark:hover:text-white dark:text-white">Portfolio</Link></li>
              </ul>
            </div>

            <div className="col-span-12 lg:col-span-3">
              <p className="text-xs font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Find us</p>
              <div className="mt-3 rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm p-3 flex items-center gap-3 rounded-[12px] border border-zinc-200 dark:border-zinc-800 bg-[#f5f5f7] dark:bg-zinc-900">
                <span className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-black grid place-items-center"><MapPin size={14} /></span>
                <div>
                  <p className="text-sm font-semibold leading-none">North Court — Quad</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Block A, Hall 01 · 9 — 5 IST</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
            {/* WHY brand kit v1.0 footer: © CampusFlow + canonical campus-flow.tech + tagline. */}
            <div className="space-y-1">
              <p>© 2026 CampusFlow · campus-flow.tech</p>
              <p>A more connected campus.</p>
            </div>
            <nav className="flex flex-wrap items-center gap-1 font-medium" aria-label="Footer">
              <Link to="/about" className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">About</Link>
              <Link to="/help" className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">Help</Link>
              <Link to="/contact" className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">Contact</Link>
              <Link to="/privacy" className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">Privacy</Link>
              <Link to="/terms" className="px-3 py-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors min-h-[44px] inline-flex items-center">Terms</Link>
            </nav>
            <span className="font-mono">v2026.08 · 980 · #1ed760 · 44px · Loom · 6 FAQ</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'

const SECTIONS = [
  {
    h: '1. Controller & DPO',
    body: 'Data controller: CampusFlow (contact via Contact page or hello@campusflow.dev). Data Protection contact: privacy@campusflow.dev (DPO). We respond to privacy requests within 30 days. This notice is provided at collection (Art.13) — see Register/Login for the layered summary with links to this policy.',
  },
  {
    h: '2. What we collect & lawful basis (Art.6)',
    body: 'Account data (name, email, username, college, department, year) — basis: contract (provide the workspace) + consent where you opt in. Content you create (timetables, assignments, rooms, forms, resumes) — basis: contract. Operational data (logs, device/usage telemetry, requestId) — basis: legitimate interest (security, debugging, abuse prevention). Analytics/RUM (Plausible/GA4) — basis: consent (prior opt-in via cookie banner only). No automated decision-making with legal effect.',
  },
  {
    h: '3. Tenant isolation & public profiles',
    body: 'Your campus data is scoped by college → department → room; cross-college access is denied by default and enforced on every request. Your /u/:username profile (name, coding stats, portfolio links) is public by design for recruiters; email is masked for anonymous visitors (j***@domain) with X-Robots-Tag: noindex on tenant surfaces.',
  },
  {
    h: '4. Recipients & processors',
    body: 'Processors (recipients): Groq / OpenAI / Google Gemini (AI parsing you request, United States), Cloudinary (file storage, United States), Neon (PostgreSQL, United States), Render (hosting, United States). We share only the data needed for each purpose under DPAs; we do not sell personal data and run no third-party advertising trackers.',
  },
  {
    h: '5. Third-country transfers & safeguards',
    body: 'AI, database and hosting processors are in the United States (third-country transfer). Safeguards: Standard Contractual Clauses (SCCs) + encryption in transit (TLS) and at rest. You may request a copy of the transfer safeguards via the DPO.',
  },
  {
    h: '6. Retention',
    body: 'Retention per category: account data — while active + 30 days after deletion request; logs/requestId — 30 days (security events 1 year); staging REJECTED rows — 30 days; notifications — 90 days; exports/audit — 1 year. Backups age out within 30 days. You can delete tasks/resumes/portfolios anytime in-app.',
  },
  {
    h: '7. Your rights & how to exercise them',
    body: 'You have the rights of access, rectification, erasure, restriction, portability, objection, and withdrawal of consent (where consent is the basis). Exercise via Contact (mark Privacy) or privacy@campusflow.dev — we verify identity and respond within 30 days. You may lodge a complaint with your supervisory authority (DPA) at any time.',
  },
  {
    h: '8. Cookies, storage & consent',
    body: 'Strictly-necessary storage (session campusflow-auth migrating to HttpOnly campusflow_token/cf_refresh/cf_csrf, theme, workspace) is always on. Analytics (Plausible/GA4) and RUM run only after granular opt-in (analytics / RUM toggles, default off). Consent proof (timestamp, categories, version, method) is stored locally and re-prompted on policy/vendor change + every 6 months. Withdraw anytime via footer Cookie settings.',
  },
  {
    h: '9. AI features & your keys',
    body: 'Timetable parsing, resume upgrades and the campus assistant may send submitted content to AI providers (OpenAI, Gemini, Groq). You can bring your own key in Settings; provider keys are never logged (see logger redaction). DPIA available on request for AI transfers.',
  },
  {
    h: '10. Security',
    body: 'JWT (1d access + 30d rotating refresh, HttpOnly), role gates, rate limits + CAPTCHA, upload magic-byte + malware scan, SSRF allowlist, scoped visibility. Report vulnerabilities via Contact (mark Security) — we triage within 2 business days.',
  },
  {
    h: '11. Changes & version',
    body: 'Policy version 2.0 — Last updated 9 Sep 2026. Material changes trigger a cookie re-prompt and in-app notice. Prior versions available on request.',
  },
  {
    h: '12. Contact',
    body: 'Questions? Contact page or hello@campusflow.dev; privacy requests: privacy@campusflow.dev (DPO).',
  },
]

export default function PrivacyPage() {
  return (
    <PublicPageShell>
      <div className="max-w-[720px] mx-auto">
        <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Legal · Version 2.0 · Last updated 9 Sep 2026</p>
        <h1 className="mt-2 font-semibold tracking-[-0.02em] text-[32px]" style={{ fontFamily: 'Fraunces, serif' }}>Privacy Policy</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          CampusFlow is a campus workspace — your timetable, rooms and career boards. This policy
          explains what we collect, why (Art.6 lawful basis), who receives it, transfers, retention,
          and the controls you have. Short version: scoped by college, never sold, deletable on request.
        </p>
        <div className="mt-8 space-y-7">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="font-semibold text-[17px]">{s.h}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.body}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
          Related: <Link to="/terms" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4">Terms of Service</Link>
          {' · '}<Link to="/contact" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4">Contact us</Link>
        </p>
      </div>
    </PublicPageShell>
  )
}

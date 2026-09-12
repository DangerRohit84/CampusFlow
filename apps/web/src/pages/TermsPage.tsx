import { Link } from 'react-router-dom'
import PublicPageShell from '../components/PublicPageShell'

const SECTIONS = [
  {
    h: '1. The service',
    body: 'CampusFlow provides campus workspaces: timetables, assignments, rooms, hackathons, internships, forms, resumes and portfolios. Free for students; colleges may purchase Campus OS plans with SSO and admin scope.',
  },
  {
    h: '2. Accounts',
    body: 'You must provide accurate registration details and keep your credentials secret. One account per person. Colleges provision teacher and admin accounts; misuse (impersonation, credential sharing) may lead to suspension.',
  },
  {
    h: '3. Acceptable use',
    body: 'Do not upload malware, scrape other tenants, attempt to bypass role or college scoping, spam rooms, or post content you have no right to share. Automated fetching must use official APIs and respect rate limits.',
  },
  {
    h: '4. Your content',
    body: 'You own what you create. By uploading, you grant CampusFlow a license to host, process (including AI parsing you request) and display it to eligible viewers within your college scope. Public profiles and portfolios you publish may be viewed by anyone with the link.',
  },
  {
    h: '5. College data',
    body: 'College admins control their tenant: membership, visibility and exports. CampusFlow processes college data as instructed by the college and isolates it from other tenants.',
  },
  {
    h: '6. Availability & changes',
    body: 'We aim for reliable service but do not guarantee uninterrupted uptime. Features may change; breaking changes to paid plans come with notice. Free tiers may have usage limits (AI calls, uploads, fetch frequency).',
  },
  {
    h: '7. Termination',
    body: 'You may stop using CampusFlow anytime and request account deletion via Contact. We may suspend accounts that violate these terms or threaten platform security, with notice where practical.',
  },
  {
    h: '8. Liability',
    body: 'To the maximum extent permitted by law, CampusFlow is provided "as is" without warranties. Our liability is limited to the fees you paid in the preceding 12 months (zero for free accounts).',
  },
  {
    h: '9. Contact',
    body: 'Questions about these terms? Reach us from the Contact page or email hello@campusflow.dev. Data controller: CampusFlow (privacy@campusflow.dev, DPO) — see Privacy Policy for Art.13 details (basis, recipients, transfers, rights, retention).',
  },
]

export default function TermsPage() {
  return (
    <PublicPageShell>
      <div className="max-w-[720px] mx-auto">
        <p className="text-[11px] font-bold tracking-widest uppercase text-zinc-500 dark:text-zinc-400">Legal · Version 2.0 · Last updated 9 Sep 2026</p>
        <h1 className="mt-2 font-semibold tracking-[-0.02em] text-[32px]" style={{ fontFamily: 'Fraunces, serif' }}>Terms of Service</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          The ground rules for using CampusFlow â€” accounts, acceptable use, your content, and
          college data. Plain language first; contact us if anything is unclear.
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
          Related: <Link to="/privacy" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4">Privacy Policy</Link>
          {' Â· '}<Link to="/contact" className="font-semibold text-zinc-900 dark:text-white underline underline-offset-4">Contact us</Link>
        </p>
      </div>
    </PublicPageShell>
  )
}


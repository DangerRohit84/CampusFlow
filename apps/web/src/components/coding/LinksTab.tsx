// components/coding/LinksTab.tsx — curated CodeChef/HackerRank/GFG/AtCoder links (plan §4).
// WHY: no official public practice catalog exists for these platforms
// (unofficial scrapers break — third-party aggregator sunset 01-08-2025), so this tab is
// STATIC link cards only: platform icon + Browse link + honest "no live
// catalog — browse there, track manually" notice. No fetch, no backend, no
// auto-verify. Totals (where a handle exists) stay in the My Stats platform
// cards only, never in the heatmap.
import { useEffect } from 'react'
import { ExternalLink, Trophy } from 'lucide-react'
import { PlatformLogo } from '../PlatformLogos'
import { trackProblemsEvent } from '../../lib/codingProblems'
import {
  ATCODER_LIBRARY_URL,
  ATCODER_SNAPSHOT_RAW_URL,
  ATCODER_SNAPSHOT_URL,
  PRACTICE_LINKS,
  PRACTICE_LINKS_NOTICE,
} from '../../lib/practiceLinks'

export default function LinksTab() {
  useEffect(() => {
    trackProblemsEvent('impression', { source: 'links-tab' })
  }, [])

  const onOpenLink = (url: string) => trackProblemsEvent('click', { titleSlug: url })

  return (
    <div className="space-y-4">
      {/* ── Honest notice (amber, same stale-badge pattern as Daily/CF) ── */}
      <section
        aria-label="No live catalog notice"
        className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-amber-200 dark:border-amber-500/20 bg-white dark:bg-night-850 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
            No live catalog
          </span>
          <p className="text-xs text-amber-800 dark:text-amber-200">{PRACTICE_LINKS_NOTICE}</p>
        </div>
      </section>

      {/* ── Link cards (static, 4 platforms) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PRACTICE_LINKS.map((l) => (
          <section
            key={l.id}
            aria-label={l.name}
            className="rounded-2xl border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-800 p-4 flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              {l.id === 'atcoder' ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-500 dark:text-night-300">
                  <Trophy size={14} />
                </span>
              ) : (
                <PlatformLogo platform={l.id} size={24} />
              )}
              <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">{l.name}</h3>
            </div>
            <p className="text-xs text-surface-500 dark:text-night-300">{l.tagline}</p>
            <p className="text-[11px] text-surface-400 dark:text-night-400">{l.whyNoCatalog}</p>
            <div className="mt-auto pt-2">
              <a
                href={l.browseUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpenLink(l.browseUrl)}
                className="inline-flex items-center gap-1 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 px-3 py-1.5 text-xs font-semibold text-primary-600 dark:text-success-300 hover:underline"
              >
                {l.browseLabel} <ExternalLink size={12} />
              </a>
            </div>

            {l.id === 'atcoder' && (
              <div className="mt-1 space-y-1 border-t border-surface-100 dark:border-night-700 pt-2 text-[11px] text-surface-400 dark:text-night-400">
                <p>
                  Community snapshot:{' '}
                  <a
                    href={ATCODER_SNAPSHOT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOpenLink(ATCODER_SNAPSHOT_URL)}
                    className="font-medium text-primary-600 dark:text-success-300 hover:underline inline-flex items-center gap-0.5"
                  >
                    kenkoooo table <ExternalLink size={10} />
                  </a>{' '}
                  ·{' '}
                  <a
                    href={ATCODER_SNAPSHOT_RAW_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOpenLink(ATCODER_SNAPSHOT_RAW_URL)}
                    className="font-medium text-primary-600 dark:text-success-300 hover:underline inline-flex items-center gap-0.5"
                  >
                    merged-problems.json <ExternalLink size={10} />
                  </a>{' '}
                  (unofficial, may deprecate).
                </p>
                <p>
                  <a
                    href={ATCODER_LIBRARY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => onOpenLink(ATCODER_LIBRARY_URL)}
                    className="font-medium text-primary-600 dark:text-success-300 hover:underline inline-flex items-center gap-0.5"
                  >
                    AtCoder Library <ExternalLink size={10} />
                  </a>{' '}
                  is a C++ library, not a problems API.
                </p>
              </div>
            )}
          </section>
        ))}
      </div>

      <p className="text-[11px] text-surface-400 dark:text-night-400">
        Browse on the platform, track manually. Totals (where you saved a handle) stay in the My Stats platform cards only — never in the heatmap.
      </p>
    </div>
  )
}

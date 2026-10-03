import { useMemo, useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import api from '../../lib/api'

interface PasteLinksCardProps {
  onRefresh: () => void
}

type PasteTab = 'HACKATHON' | 'INTERNSHIP'

interface PerUrl {
  url: string
  ok: boolean
  title?: string
  error?: string
}

interface PasteResult {
  success: boolean
  fetched: number
  saved: number
  hackathons: number
  internships: number
  skipped: number
  enriched: number
  source: string
  perUrl: PerUrl[]
  failed: number
  message?: string
}

function countLinks(raw: string): number {
  const parts = String(raw || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  for (const p of parts) {
    const k = p.toLowerCase().replace(/#.*$/, '').replace(/\/$/, '')
    if (!seen.has(k)) seen.add(k)
  }
  return seen.size
}

export default function PasteLinksCard({ onRefresh }: PasteLinksCardProps) {
  const [tab, setTab] = useState<PasteTab>('HACKATHON')
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PasteResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const detected = useMemo(() => countLinks(raw), [raw])
  const overLimit = detected > 20

  const handleFetch = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const { data } = await api.post(
        '/fetch/paste-links',
        { type: tab, raw },
        { timeout: 180000 },
      )
      setResult(data as PasteResult)
      onRefresh()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string }
      setError(err?.response?.data?.error || err?.message || 'Paste-links fetch failed')
    } finally {
      setLoading(false)
    }
  }

  const failed = result?.perUrl?.filter((p) => !p.ok) || []

  return (
    <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
      <div className="h-[3px] bg-brass-400" />
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center shrink-0">
              <Link2 size={18} className="text-brass-400" />
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold text-surface-900 dark:text-night-50 leading-none">
                Paste Links
              </h2>
              <p className="text-xs text-surface-500 dark:text-night-400 mt-1">
                Superadmin-only · one or bulk URLs · staged separately per type.
              </p>
            </div>
          </div>
          <div className="flex rounded-xl border border-surface-200 dark:border-night-600 overflow-hidden" role="tablist" aria-label="Paste links type">
            {(['HACKATHON', 'INTERNSHIP'] as PasteTab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`px-4 min-h-[40px] text-sm font-semibold transition-colors ${
                  tab === t
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-night-800 text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700'
                }`}
              >
                {t === 'HACKATHON' ? 'Hackathon links' : 'Internship links'}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="text-sm font-semibold text-surface-700 dark:text-night-200">
            {tab === 'HACKATHON' ? 'Hackathon URLs' : 'Internship URLs'}
            <span className="ml-2 text-xs font-normal text-surface-500 dark:text-night-400">
              one per line, comma or space separated · max 20 · deduped
            </span>
          </span>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            placeholder={'https://example.com/hackathon-1\nhttps://example.com/hackathon-2, https://example.com/hackathon-3'}
            aria-label={tab === 'HACKATHON' ? 'Hackathon links to fetch' : 'Internship links to fetch'}
            className="mt-2 w-full text-sm border border-surface-300 dark:border-night-600 rounded-xl px-3 py-2 bg-white dark:bg-night-800 text-surface-800 dark:text-night-100 focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[96px]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleFetch}
            disabled={loading || detected === 0 || overLimit}
            className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? 'Fetching links…' : `Fetch ${tab === 'HACKATHON' ? 'hackathons' : 'internships'}`}
          </button>
          <span className={`text-xs ${overLimit ? 'text-red-600 font-semibold' : 'text-surface-500 dark:text-night-400'}`}>
            {detected === 0 ? 'Paste at least 1 URL' : `${detected} link${detected > 1 ? 's' : ''} detected${overLimit ? ' — over 20 max, remove some' : ''}`}
          </span>
          {result && (
            <span className="text-sm text-green-700 dark:text-green-300">
              Staged {result.saved} ({result.hackathons} hackathons, {result.internships} internships)
              {result.failed > 0 ? ` · ${result.failed} failed` : ''}
              {typeof result.enriched === 'number' ? ` · enriched ${result.enriched}` : ''}
            </span>
          )}
          {error && (
            <span className="text-sm text-red-600 dark:text-red-300" role="alert">
              {error}
            </span>
          )}
        </div>

        {result?.message && (
          <p className="text-xs text-surface-500 dark:text-night-400">{result.message}</p>
        )}

        {failed.length > 0 && (
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-800 dark:text-red-200" role="alert">
            <p className="font-semibold mb-1">{failed.length} link{failed.length > 1 ? 's' : ''} failed (others still staged):</p>
            <ul className="list-disc list-inside space-y-0.5 max-h-32 overflow-auto">
              {failed.slice(0, 20).map((f) => (
                <li key={f.url} title={f.error || 'Fetch failed'}>
                  <span className="font-mono break-all">{f.url}</span>
                  {f.error ? ` — ${f.error.slice(0, 120)}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

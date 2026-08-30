import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle, ExternalLink } from 'lucide-react'
import { parsePortyMessage } from '../../lib/porty'

type Props = {
  importUrl: string | null
  onPublished: (slug: string) => void
}

export default function PortyFrame({ importUrl, onPublished }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!importUrl) return
    setLoading(true)
    setError(null)
    const handler = (e: MessageEvent) => {
      const parsed = parsePortyMessage(e)
      if (parsed) {
        onPublished(parsed.slug)
      }
    }
    window.addEventListener('message', handler)
    const timer = setTimeout(() => {
      // If still loading after 12s, hint about postMessage fallback
      setLoading(false)
    }, 12000)
    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(timer)
    }
  }, [importUrl, onPublished])

  if (!importUrl) return null

  return (
    <div className="space-y-3">
      <div className="relative rounded-2xl overflow-hidden border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 shadow-sm" style={{ height: 700 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 dark:bg-night-900/80 backdrop-blur-sm gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            <p className="text-sm font-medium text-surface-600 dark:text-night-200">Loading Porty…</p>
            <p className="text-xs text-surface-400 dark:text-night-400">If it stays blank, check your connection or open in new tab.</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white dark:bg-night-900 gap-2 p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm font-semibold text-surface-900 dark:text-night-50">Porty failed to load</p>
            <p className="text-xs text-surface-500 dark:text-night-300">{error}</p>
            <a href={importUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"><ExternalLink size={12}/> Open Porty directly</a>
          </div>
        )}
        <iframe
          src={importUrl}
          title="Porty Portfolio Studio"
          className="w-full h-full border-0"
          allow="clipboard-write"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false)
            setError('Unable to load Porty. It may be offline or blocked.')
          }}
        />
      </div>
      <p className="text-xs text-surface-400 dark:text-night-400 text-center">
        Publish inside the preview above. When Porty says “Published”, we’ll capture your link automatically. If not, paste your URL below.
      </p>
    </div>
  )
}

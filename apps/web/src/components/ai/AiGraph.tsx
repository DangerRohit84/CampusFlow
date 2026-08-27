import type { AiProvider, AiRouting } from '../../types/api'

interface Props {
  providers: AiProvider[]
  routing: AiRouting[]
}

const PROVIDER_COLORS: Record<string, string> = {
  Groq: '#F55036',
  OpenAI: '#10A37F',
  Anthropic: '#D97757',
  'Google Gemini': '#4285F4',
  'Mistral AI': '#FF7000',
  DeepSeek: '#4D6BFE',
  Ollama: '#FFFFFF',
  'OpenCode Serve': '#A855F7',
}

const FEATURES = ['Chat', 'Fetch', 'Enrichment', 'Tasks', 'Timetable', 'Attendance', 'Grades']

export default function AiGraph({ providers, routing }: Props) {
  const allProviders = providers
  const providerY = (i: number) => 60 + i * 70
  const featureY = (i: number) => 60 + i * 70
  const totalHeight = Math.max(320, allProviders.length * 70 + 40)

  const lines = routing.map(r => {
    const provider = providers.find(p => p.id === r.providerId)
    if (!provider) return null
    const featureIdx = ['chat', 'fetch', 'enrichment', 'tasks', 'timetable', 'attendance', 'grades'].indexOf(r.feature)
    if (featureIdx < 0) return null
    return {
      provider,
      feature: FEATURES[featureIdx],
      featureIdx,
      primary: r.fallbackOrder === 0,
    }
  }).filter(Boolean) as { provider: AiProvider; feature: string; featureIdx: number; primary: boolean }[]

  return (
    <div className="bg-surface-50 dark:bg-night-800 rounded-xl border border-surface-200 dark:border-night-600 p-4 overflow-x-auto">
      {allProviders.length === 0 ? (
        <p className="text-center text-surface-500 dark:text-night-300 py-8">No providers configured</p>
      ) : (
        <svg viewBox={`0 0 600 ${totalHeight}`} className="w-full min-w-[500px]">
          {/* Provider nodes */}
          {allProviders.map((p, i) => (
            <g key={p.id}>
              <rect x={20} y={providerY(i)} width={140} height={40} rx={8}
                fill="#111920"
                stroke={PROVIDER_COLORS[p.name] || '#A855F7'}
                strokeWidth={2}
                opacity={p.enabled ? 1 : 0.35} />
              <circle cx={36} cy={providerY(i) + 20} r={4}
                fill={p.enabled ? '#22C55E' : '#6B7280'}
                opacity={p.enabled ? 1 : 0.5} />
              <text x={48} y={providerY(i) + 25}
                fill={p.enabled ? '#F4F7F8' : '#71808C'}
                fontSize={12} fontWeight={500}
                opacity={p.enabled ? 1 : 0.5}>
                {p.name}
              </text>
              {!p.enabled && (
                <text x={165} y={providerY(i) + 25} fill="#71808C" fontSize={10} opacity={0.6}>
                  disabled
                </text>
              )}
            </g>
          ))}

          {/* Feature nodes */}
          {FEATURES.map((f, i) => (
            <g key={f}>
              <rect x={420} y={featureY(i)} width={140} height={40} rx={8}
                fill="#111920" stroke="#202C35" strokeWidth={1} />
              <text x={490} y={featureY(i) + 25} fill="#A6B3BE" fontSize={12} fontWeight={500} textAnchor="middle">
                {f}
              </text>
            </g>
          ))}

          {/* Connection lines */}
          {lines.map((l, i) => {
            const pIdx = allProviders.findIndex(p => p.id === l.provider.id)
            const fIdx = l.featureIdx
            if (pIdx < 0 || fIdx < 0) return null
            const x1 = 160, y1 = providerY(pIdx) + 20
            const x2 = 420, y2 = featureY(fIdx) + 20
            const color = PROVIDER_COLORS[l.provider.name] || '#A855F7'
            return (
              <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={color} strokeWidth={2}
                strokeDasharray={l.primary ? 'none' : '8 4'}
                opacity={0.7} />
            )
          })}

          {/* Empty state */}
          {lines.length === 0 && allProviders.length > 0 && (
            <text x={300} y={totalHeight - 30} fill="#71808C" fontSize={11} textAnchor="middle">
              No routes assigned yet  —  configure routing in the table below
            </text>
          )}

          {/* Legend */}
          <line x1={20} y1={totalHeight - 15} x2={60} y2={totalHeight - 15}
            stroke="#A6B3BE" strokeWidth={2} />
          <text x={68} y={totalHeight - 12} fill="#71808C" fontSize={10}>Primary</text>
          <line x1={130} y1={totalHeight - 15} x2={170} y2={totalHeight - 15}
            stroke="#A6B3BE" strokeWidth={2} strokeDasharray="8 4" />
          <text x={178} y={totalHeight - 12} fill="#71808C" fontSize={10}>Fallback</text>
        </svg>
      )}
    </div>
  )
}

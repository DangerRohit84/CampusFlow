import { useState } from 'react'
import { Save, Loader2 } from 'lucide-react'
import type { AiProvider, AiRouting } from '../../types/api'

interface Props {
  providers: AiProvider[]
  routing: AiRouting[]
  onSave: (feature: string, providerIds: (string | null)[]) => Promise<void>
}

const FEATURES = [
  { id: 'chat', label: 'Chat', desc: 'CampusFlow AI chatbot' },
  { id: 'fetch', label: 'Fetch', desc: 'Scrape hackathon/internship URLs' },
  { id: 'enrichment', label: 'Enrichment', desc: 'Opportunity data enrichment' },
  { id: 'tasks', label: 'Tasks', desc: 'AI task generation' },
  { id: 'timetable', label: 'Timetable', desc: 'Schedule optimization' },
  { id: 'attendance', label: 'Attendance', desc: 'Attendance image parsing & prediction' },
  { id: 'grades', label: 'Grades', desc: 'Grade image parsing & CGPA calculation' },
]

export default function RoutingTable({ providers, routing, onSave }: Props) {
  const [local, setLocal] = useState<Record<string, (string | null)[]>>(() => {
    const map: Record<string, (string | null)[]> = {}
    for (const f of FEATURES) {
      map[f.id] = routing
        .filter(r => r.feature === f.id)
        .sort((a, b) => a.fallbackOrder - b.fallbackOrder)
        .map(r => r.providerId)
    }
    return map
  })
  const [saving, setSaving] = useState<string | null>(null)

  const enabled = providers.filter(p => p.enabled)

  const handleChange = (feature: string, order: number, providerId: string | null) => {
    setLocal(prev => {
      const arr = [...(prev[feature] || [])]
      arr[order] = providerId
      return { ...prev, [feature]: arr }
    })
  }

  const handleSave = async (feature: string) => {
    setSaving(feature)
    await onSave(feature, local[feature] || [])
    setSaving(null)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-200 dark:border-night-600">
            <th className="text-left py-3 px-4 text-surface-600 dark:text-night-300 font-medium">Feature</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-night-300 font-medium">Description</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-night-300 font-medium">Primary</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-night-300 font-medium">Fallback 1</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-night-300 font-medium">Fallback 2</th>
            <th className="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map(f => (
            <tr key={f.id} className="border-b border-surface-100 dark:border-night-700">
              <td className="py-3 px-4 font-medium text-surface-900 dark:text-night-50">{f.label}</td>
              <td className="py-3 px-4 text-surface-600 dark:text-night-300">{f.desc}</td>
              {[0, 1, 2].map(order => (
                <td key={order} className="py-3 px-4">
                  <select
                    value={local[f.id]?.[order] || ''}
                    onChange={e => handleChange(f.id, order, e.target.value || null)}
                    className="w-full px-2 py-1.5 rounded-lg border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 text-sm"
                  >
                    <option value="">None</option>
                    {enabled.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </td>
              ))}
              <td className="py-3 px-4">
                <button
                  onClick={() => handleSave(f.id)}
                  disabled={saving === f.id}
                  className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-night-700 text-primary-600 dark:text-[#7BA290]"
                >
                  {saving === f.id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

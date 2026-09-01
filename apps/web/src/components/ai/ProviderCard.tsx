import { useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'
import type { AiProvider } from '../../types/api'
import api from '../../lib/api'

interface Props {
  provider: AiProvider
  onEdit: (p: AiProvider) => void
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onTest: (id: string) => Promise<void>
}

const TYPE_COLORS: Record<string, string> = {
  'openai-compatible': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  anthropic: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  google: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
}

export default function ProviderCard({ provider, onEdit, onToggle, onDelete, onTest }: Props) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post(`/ai-manager/providers/${provider.id}/test`)
      if (res.data.success) {
        setTestResult({ ok: true, msg: `Connected! (${res.data.latency}ms)` })
      } else {
        setTestResult({ ok: false, msg: res.data.error || 'Test failed' })
      }
    } catch (err: any) {
      setTestResult({ ok: false, msg: err.response?.data?.error || 'Connection failed' })
    }
    setTesting(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 ${
        provider.enabled
          ? 'bg-surface-50 border-surface-200 dark:bg-night-800 dark:border-night-600'
          : 'bg-surface-100 border-surface-200 opacity-60 dark:bg-night-900 dark:border-night-600'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${provider.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
          <h3 className="font-semibold text-surface-900 dark:text-night-50">{provider.name}</h3>
        </div>
        <button
          onClick={() => onToggle(provider.id)}
          className="text-surface-500 hover:text-primary-600 dark:text-night-300 dark:hover:text-success-300"
        >
          {provider.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
        </button>
      </div>

      <p className="text-sm text-surface-600 dark:text-night-300 mb-2 truncate">{provider.baseUrl}</p>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-surface-200 text-surface-700 dark:bg-night-700 dark:text-night-200">
          {provider.model}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[provider.type] || ''}`}>
          {provider.type}
        </span>
      </div>

      <p className="text-xs text-surface-500 dark:text-night-300 font-mono mb-3">{provider.apiKey}</p>

      {testResult && (
        <p className={`text-xs mb-2 ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
          {testResult.msg}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 dark:bg-night-700 dark:hover:bg-night-600 text-surface-700 dark:text-night-200"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test
        </button>
        <button
          onClick={() => onEdit(provider)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 dark:bg-night-700 dark:hover:bg-night-600 text-surface-700 dark:text-night-200"
        >
          <Pencil size={12} /> Edit
        </button>
        {!provider.isBuiltIn && (
          <button
            onClick={() => onDelete(provider.id)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400"
          >
            <Trash2 size={12} /> Delete
          </button>
        )}
      </div>
    </motion.div>
  )
}
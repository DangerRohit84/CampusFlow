import { useState, useEffect } from 'react'
import { Plus, Zap, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import ProviderCard from '../components/ai/ProviderCard'
import ProviderModal from '../components/ai/ProviderModal'
import RoutingTable from '../components/ai/RoutingTable'
import AiGraph from '../components/ai/AiGraph'
import type { AiProvider, AiRouting } from '../types/api'

export default function AiManagerPage() {
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [routing, setRouting] = useState<AiRouting[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AiProvider | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    const [p, r] = await Promise.all([
      api.get('/ai-manager/providers'),
      api.get('/ai-manager/routing'),
    ])
    setProviders(p.data.providers)
    setRouting(r.data.routing)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSave = async (data: any) => {
    if (editing) {
      const res = await api.put(`/ai-manager/providers/${editing.id}`, data)
      setProviders(prev => prev.map(p => p.id === editing.id ? res.data.provider : p))
    } else {
      const res = await api.post('/ai-manager/providers', data)
      setProviders(prev => [...prev, res.data.provider])
    }
    setModalOpen(false)
    setEditing(null)
    toast.success('Provider saved')
  }

  const handleToggle = async (id: string) => {
    const res = await api.patch(`/ai-manager/providers/${id}/toggle`)
    setProviders(prev => prev.map(p => p.id === id ? res.data.provider : p))
    toast.success('Updated')
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this provider?')) return
    await api.delete(`/ai-manager/providers/${id}`)
    setProviders(prev => prev.filter(p => p.id !== id))
    setRouting(prev => prev.filter(r => r.providerId !== id))
    toast.success('Provider deleted')
  }

  const handleTest = async (id: string) => {
    try {
      const res = await api.post(`/ai-manager/providers/${id}/test`)
      if (res.data.success) {
        toast.success(`Provider working (${res.data.latency}ms)`)
      } else {
        toast.error(res.data.error || 'Provider test failed')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Provider test failed')
    }
  }

  const handleTestAll = async () => {
    const enabled = providers.filter(p => p.enabled)
    for (const p of enabled) {
      try {
        const res = await api.post(`/ai-manager/providers/${p.id}/test`)
        if (!res.data.success) toast.error(`${p.name}: ${res.data.error}`)
      } catch {}
    }
    toast.success('All tests complete')
  }

  const handleRoutingSave = async (feature: string, providerIds: (string | null)[]) => {
    const res = await api.put('/ai-manager/routing', { feature, providerIds })
    setRouting(res.data.routing)
    toast.success('Routing saved')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-600 dark:text-[#00A88F]" size={32} />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-[#F4F7F8]">AI Manager</h1>
          <p className="text-surface-600 dark:text-[#71808C]">Manage AI providers and feature routing</p>
        </div>
        <div className="flex gap-3">
          <button onClick={handleTestAll}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] text-surface-700 dark:text-[#A6B3BE] hover:bg-surface-100 dark:hover:bg-[#151F27]">
            <Zap size={16} /> Test All
          </button>
          <button onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 dark:bg-[#00A88F] dark:hover:bg-[#00C49A] text-white">
            <Plus size={16} /> Add Provider
          </button>
        </div>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {providers.map(p => (
          <ProviderCard
            key={p.id} provider={p}
            onEdit={(p) => { setEditing(p); setModalOpen(true) }}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onTest={handleTest}
          />
        ))}
      </div>

      {/* Routing Table */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-[#F4F7F8] mb-4">Feature Routing</h2>
        <div className="bg-surface-50 dark:bg-[#111920] rounded-xl border border-surface-200 dark:border-[#202C35] overflow-hidden">
          <RoutingTable providers={providers} routing={routing} onSave={handleRoutingSave} />
        </div>
      </div>

      {/* Visual Graph */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-[#F4F7F8] mb-4">Visual Graph</h2>
        <AiGraph providers={providers} routing={routing} />
      </div>

      {/* Modal */}
      <ProviderModal open={modalOpen} provider={editing} onSave={handleSave} onClose={() => setModalOpen(false)} />
    </div>
  )
}

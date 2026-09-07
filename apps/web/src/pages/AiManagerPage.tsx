import { useState, useEffect } from 'react'
import { Plus, Zap, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import ProviderCard from '../components/ai/ProviderCard'
import ProviderModal from '../components/ai/ProviderModal'
import RoutingTable from '../components/ai/RoutingTable'
import AiGraph from '../components/ai/AiGraph'
import type { AiProvider, AiRouting } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'

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
    return <CenteredLoader text="Loading AI managers..." />
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<Sparkles size={18} />}
        eyebrow="Platform · AI"
        title={<>AI Manager</>}
        subtitle="Models, routing and sync — powering Studio and Fetch."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
        <div className="h-[3px] bg-brass-400" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center"><Zap size={18} className="text-brass-400" /></div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">AI Manager — Routing Desk</h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Providers & feature routing. Flat, rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm, no gradients.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleTestAll}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-700 dark:text-night-200 hover:bg-surface-50 dark:hover:bg-night-700 text-sm font-semibold">
              <Zap size={16} /> Test All
            </button>
            <button onClick={() => { setEditing(null); setModalOpen(true) }}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold">
              <Plus size={16} /> Add Provider
            </button>
          </div>
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
        <h2 className="text-lg font-semibold text-surface-900 dark:text-night-50 mb-4">Feature Routing</h2>
        <div className="bg-surface-50 dark:bg-night-800 rounded-xl border border-surface-200 dark:border-night-600 overflow-hidden">
          <RoutingTable providers={providers} routing={routing} onSave={handleRoutingSave} />
        </div>
      </div>

      {/* Visual Graph */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-night-50 mb-4">Visual Graph</h2>
        <AiGraph providers={providers} routing={routing} />
      </div>

      {/* Modal */}
      <ProviderModal open={modalOpen} provider={editing} onSave={handleSave} onClose={() => setModalOpen(false)} />
    </div>
  )
}

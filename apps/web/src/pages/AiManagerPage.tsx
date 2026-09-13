import { useState, useEffect } from 'react'
import { Plus, Zap, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import ProviderCard from '../components/ai/ProviderCard'
import ProviderModal from '../components/ai/ProviderModal'
import RoutingTable from '../components/ai/RoutingTable'
import AiGraph from '../components/ai/AiGraph'
import AiUsagePanel from '../components/ai/AiUsagePanel'
import { adminAPI } from '../lib/api/resources/admin'
import type { AiProvider, AiRouting } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

export default function AiManagerPage() {
  const { confirm: confirmDialog } = useConfirm()
  const [providers, setProviders] = useState<AiProvider[]>([])
  const [routing, setRouting] = useState<AiRouting[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AiProvider | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [colleges, setColleges] = useState<{ id: string; name: string; code: string }[]>([])

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [p, r, c] = await Promise.all([
        api.get('/ai-manager/providers'),
        api.get('/ai-manager/routing'),
        adminAPI.getColleges().catch(() => [] as { id: string; name: string; code: string }[]),
      ])
      setProviders(p.data.providers || [])
      setRouting(r.data.routing || [])
      setColleges(Array.isArray(c) ? c : [])
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Could not load AI providers.'
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSave = async (data: any) => {
    try {
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
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to save provider')
    }
  }

  const handleToggle = async (id: string) => {
    try {
      const res = await api.patch(`/ai-manager/providers/${id}/toggle`)
      setProviders(prev => prev.map(p => p.id === id ? res.data.provider : p))
      toast.success('Updated')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to update provider')
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete provider?', message: 'Delete this AI provider and its routing rules?', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await api.delete(`/ai-manager/providers/${id}`)
      setProviders(prev => prev.filter(p => p.id !== id))
      setRouting(prev => prev.filter(r => r.providerId !== id))
      toast.success('Provider deleted')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to delete provider')
    }
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
    // PARALLEL (PERPAGE-HALF2: was `for…await` — N sequential POSTs, one slow
    // provider stalled the rest). Toast semantics identical (per-provider
    // error, single completion toast); network errors stay silent as before.
    await Promise.all(enabled.map(async (p) => {
      try {
        const res = await api.post(`/ai-manager/providers/${p.id}/test`)
        if (!res.data.success) toast.error(`${p.name}: ${res.data.error}`)
      } catch {}
    }))
    toast.success('All tests complete')
  }

  const handleRoutingSave = async (feature: string, providerIds: (string | null)[]) => {
    try {
      const res = await api.put('/ai-manager/routing', { feature, providerIds })
      setRouting(res.data.routing)
      toast.success('Routing saved')
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to save routing')
    }
  }

  if (loading) {
    return <CenteredLoader text="Loading AI managers..." />
  }

  if (loadError) {
    return (
      <div className="max-w-[1280px] mx-auto">
        <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] p-8 text-center" role="alert">
          <p className="font-bold text-surface-900 dark:text-night-50">Couldn&apos;t load AI Manager</p>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-1">{loadError}</p>
          <button onClick={load} className="mt-4 px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
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

      {/* #11 AI metering: per-college usage counters + cost caps. */}
      <div className="mb-8">
        <AiUsagePanel colleges={colleges} />
      </div>

      {/* Modal */}
      <ProviderModal open={modalOpen} provider={editing} onSave={handleSave} onClose={() => setModalOpen(false)} />
    </div>
  )
}

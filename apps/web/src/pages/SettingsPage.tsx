import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  User, Mail, Building2, GraduationCap, Bell, Palette, Link2, Moon, Sun, Monitor,
  Camera, Save, Sparkles, LogOut, Key, Check, AlertCircle, Eye, EyeOff, ExternalLink,
  Zap, Brain, Cpu, Globe, Shield, ChevronDown, ChevronRight, X, Plus, Trash2, Copy
} from 'lucide-react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import { useAuthStore } from '../store/authStore'
import { userAPI } from '../lib/api'
import toast from 'react-hot-toast'

interface AIProvider {
  id: string
  name: string
  logo: string
  color: string
  models: { id: string; name: string; tier: string; pricing: string; context: string }[]
  baseUrl: string
  keyPrefix: string
  description: string
  website: string
  freeTier?: string
}

const aiProviders: AIProvider[] = [
  {
    id: 'openai', name: 'OpenAI', logo: '🟢', color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    baseUrl: 'https://api.openai.com/v1', keyPrefix: 'sk-', description: 'GPT-5, GPT-4.1, o3, o4-mini', website: 'https://platform.openai.com', freeTier: 'Free $5 credit',
    models: [
      { id: 'gpt-5', name: 'GPT-5', tier: 'Frontier', pricing: '$10 / $30 per 1M', context: '1M' },
      { id: 'gpt-4.1', name: 'GPT-4.1', tier: 'Flagship', pricing: '$2 / $8 per 1M', context: '1M' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', tier: 'Value', pricing: '$0.40 / $1.60 per 1M', context: '1M' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'Budget', pricing: '$0.15 / $0.60 per 1M', context: '128K' },
      { id: 'o3', name: 'o3', tier: 'Reasoning', pricing: '$2 / $8 per 1M', context: '200K' },
      { id: 'o4-mini', name: 'o4-mini', tier: 'Reasoning', pricing: '$1.10 / $4.40 per 1M', context: '200K' },
    ],
  },
  {
    id: 'anthropic', name: 'Anthropic', logo: '🟤', color: 'bg-orange-100 text-orange-700 border-orange-200',
    baseUrl: 'https://api.anthropic.com/v1', keyPrefix: 'sk-ant-', description: 'Claude Opus, Sonnet, Haiku — best for coding', website: 'https://console.anthropic.com', freeTier: 'Free tier with limits',
    models: [
      { id: 'claude-opus-4', name: 'Claude Opus 4', tier: 'Frontier', pricing: '$5 / $25 per 1M', context: '200K' },
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', tier: 'Flagship', pricing: '$3 / $15 per 1M', context: '200K' },
      { id: 'claude-haiku-3.5', name: 'Claude Haiku 3.5', tier: 'Budget', pricing: '$0.80 / $4 per 1M', context: '200K' },
    ],
  },
  {
    id: 'google', name: 'Google Gemini', logo: '🔵', color: 'bg-blue-100 text-blue-700 border-blue-200',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyPrefix: 'AIza', description: 'Gemini 2.5 Pro & Flash — best free tier', website: 'https://aistudio.google.com', freeTier: 'Free Gemini 2.0 Flash',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'Frontier', pricing: '$1.25 / $10 per 1M', context: '1M' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'Value', pricing: '$0.15 / $0.60 per 1M', context: '1M' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'Free', pricing: 'Free', context: '1M' },
    ],
  },
  {
    id: 'groq', name: 'Groq', logo: '⚡', color: 'bg-amber-100 text-amber-700 border-amber-200',
    baseUrl: 'https://api.groq.com/openai/v1', keyPrefix: 'gsk_', description: 'Ultra-fast inference — Llama, Mixtral', website: 'https://console.groq.com', freeTier: '14.4K requests/day free',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', tier: 'Flagship', pricing: '$0.59 / $0.79 per 1M', context: '128K' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', tier: 'Budget', pricing: '$0.05 / $0.08 per 1M', context: '128K' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', tier: 'Value', pricing: '$0.24 / $0.24 per 1M', context: '32K' },
    ],
  },
  {
    id: 'mistral', name: 'Mistral AI', logo: '🟣', color: 'bg-purple-100 text-purple-700 border-purple-200',
    baseUrl: 'https://api.mistral.ai/v1', keyPrefix: '', description: 'Mistral Large, Small, Codestral', website: 'https://console.mistral.ai', freeTier: 'Free tier available',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', tier: 'Flagship', pricing: '$2 / $6 per 1M', context: '128K' },
      { id: 'mistral-small-latest', name: 'Mistral Small', tier: 'Value', pricing: '$0.10 / $0.30 per 1M', context: '128K' },
      { id: 'codestral-latest', name: 'Codestral', tier: 'Code', pricing: '$0.30 / $0.90 per 1M', context: '32K' },
    ],
  },
  {
    id: 'deepseek', name: 'DeepSeek', logo: '🐋', color: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    baseUrl: 'https://api.deepseek.com/v1', keyPrefix: 'sk-', description: 'Cheapest frontier quality', website: 'https://platform.deepseek.com', freeTier: 'Free credits on signup',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V4 Chat', tier: 'Flagship', pricing: '$0.28 / $1.10 per 1M', context: '64K' },
      { id: 'deepseek-reasoner', name: 'DeepSeek V4 Reasoner', tier: 'Reasoning', pricing: '$0.55 / $2.19 per 1M', context: '64K' },
    ],
  },
  {
    id: 'xai', name: 'xAI (Grok)', logo: '⚫', color: 'bg-gray-100 text-gray-700 border-gray-200',
    baseUrl: 'https://api.x.ai/v1', keyPrefix: 'xai-', description: 'Grok 4, real-time knowledge', website: 'https://console.x.ai',
    models: [
      { id: 'grok-4', name: 'Grok 4', tier: 'Frontier', pricing: '$3 / $15 per 1M', context: '128K' },
      { id: 'grok-4-mini', name: 'Grok 4 Mini', tier: 'Value', pricing: '$0.30 / $0.50 per 1M', context: '128K' },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter', logo: '🌐', color: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    baseUrl: 'https://openrouter.ai/api/v1', keyPrefix: 'sk-or-', description: 'One key, 100+ models from all providers', website: 'https://openrouter.ai', freeTier: 'Free models available',
    models: [
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4 (OR)', tier: 'Frontier', pricing: '+5.5% markup', context: '200K' },
      { id: 'openai/gpt-4.1', name: 'GPT-4.1 (OR)', tier: 'Flagship', pricing: '+5.5% markup', context: '1M' },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (Free)', tier: 'Free', pricing: 'Free', context: '128K' },
    ],
  },
  {
    id: 'together', name: 'Together AI', logo: '🤝', color: 'bg-violet-100 text-violet-700 border-violet-200',
    baseUrl: 'https://api.together.xyz/v1', keyPrefix: '', description: 'Open-source hosting, fine-tuning', website: 'https://api.together.xyz', freeTier: '$5 free credit',
    models: [
      { id: 'meta-llama/Llama-4-Scout-17B-16E-Instruct', name: 'Llama 4 Scout', tier: 'Flagship', pricing: '$0.18 / $0.59 per 1M', context: '128K' },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', tier: 'Value', pricing: '$0.27 / $1.10 per 1M', context: '128K' },
    ],
  },
  {
    id: 'fireworks', name: 'Fireworks AI', logo: '🎆', color: 'bg-rose-100 text-rose-700 border-rose-200',
    baseUrl: 'https://api.fireworks.ai/inference/v1', keyPrefix: 'fw_', description: 'Fastest open-source inference', website: 'https://fireworks.ai', freeTier: 'Free Llama models',
    models: [
      { id: 'accounts/fireworks/models/deepseek-v3', name: 'DeepSeek V3', tier: 'Value', pricing: '$0.27 / $1.10 per 1M', context: '128K' },
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', tier: 'Flagship', pricing: '$0.90 / $0.90 per 1M', context: '128K' },
    ],
  },
  {
    id: 'cerebras', name: 'Cerebras', logo: '🧠', color: 'bg-teal-100 text-teal-700 border-teal-200',
    baseUrl: 'https://api.cerebras.ai/v1', keyPrefix: 'csk-', description: 'Wafer-scale inference, 2100 tok/s', website: 'https://cloud.cerebras.ai', freeTier: 'Free tier available',
    models: [
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', tier: 'Flagship', pricing: '$0.60 / $0.60 per 1M', context: '128K' },
      { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', tier: 'Budget', pricing: '$0.10 / $0.10 per 1M', context: '128K' },
    ],
  },
  {
    id: 'huggingface', name: 'Hugging Face', logo: '🤗', color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    baseUrl: 'https://api-inference.huggingface.co/v1', keyPrefix: 'hf_', description: '100K+ open models, free inference', website: 'https://huggingface.co', freeTier: 'Free for many open models',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', tier: 'Flagship', pricing: '$0.07 per 1M', context: '128K' },
    ],
  },
  {
    id: 'cloudflare', name: 'Cloudflare Workers AI', logo: '☁️', color: 'bg-sky-100 text-sky-700 border-sky-200',
    baseUrl: 'https://api.cloudflare.com/client/v4/accounts', keyPrefix: '', description: 'Edge AI in 200+ cities', website: 'https://workers.cloudflare.com/ai', freeTier: '10K Neurons/day free',
    models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp16', name: 'Llama 3.3 70B', tier: 'Flagship', pricing: '$0.29 / $2.25 per 1M', context: '128K' },
      { id: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout', tier: 'Flagship', pricing: '$0.27 / $0.85 per 1M', context: '128K' },
    ],
  },
  {
    id: 'cohere', name: 'Cohere', logo: '💎', color: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    baseUrl: 'https://api.cohere.com/v2', keyPrefix: '', description: 'Command R+ — best for RAG', website: 'https://dashboard.cohere.com', freeTier: 'Free trial',
    models: [
      { id: 'command-r-plus-08-2024', name: 'Command R+', tier: 'Flagship', pricing: '$2.50 / $10 per 1M', context: '128K' },
    ],
  },
  {
    id: 'novita', name: 'Novita AI', logo: '🔮', color: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200',
    baseUrl: 'https://api.novita.ai/v3/openai', keyPrefix: '', description: 'Budget aggregator, 50+ models', website: 'https://novita.ai', freeTier: '$0.50 free credits',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', tier: 'Budget', pricing: '$0.14 / $0.28 per 1M', context: '64K' },
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', tier: 'Value', pricing: '$0.135 / $0.40 per 1M', context: '128K' },
    ],
  },
  {
    id: 'ollama', name: 'Ollama (Local)', logo: '🦙', color: 'bg-slate-100 text-slate-700 border-slate-200',
    baseUrl: 'http://localhost:11434/v1', keyPrefix: '', description: 'Run models locally, free & private', website: 'https://ollama.com', freeTier: 'Free — runs on your hardware',
    models: [
      { id: 'llama3.3:70b', name: 'Llama 3.3 70B', tier: 'Free', pricing: 'Free (local)', context: '128K' },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', tier: 'Free', pricing: 'Free (local)', context: '128K' },
      { id: 'mistral:7b', name: 'Mistral 7B', tier: 'Free', pricing: 'Free (local)', context: '32K' },
      { id: 'qwen3:8b', name: 'Qwen3 8B', tier: 'Free', pricing: 'Free (local)', context: '32K' },
    ],
  },
  {
    id: 'lmstudio', name: 'LM Studio (Local)', logo: '🖥️', color: 'bg-stone-100 text-stone-700 border-stone-200',
    baseUrl: 'http://localhost:1234/v1', keyPrefix: '', description: 'Desktop GUI for local LLMs', website: 'https://lmstudio.ai', freeTier: 'Free',
    models: [
      { id: 'llama-3.3-70b-instruct', name: 'Llama 3.3 70B', tier: 'Free', pricing: 'Free (local)', context: '128K' },
    ],
  },
  {
    id: 'other', name: 'Other', logo: '⚙️', color: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    baseUrl: '', keyPrefix: '', description: 'Any OpenAI-compatible API — LiteLLM, vLLM, LocalAI, proxied', website: '',
    models: [
      { id: 'custom', name: 'Custom Model', tier: 'Custom', pricing: 'Varies', context: 'Varies' },
    ],
  },
]

interface APIConfig {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  enabled: boolean
}

const tierColors: Record<string, string> = {
  Frontier: 'bg-red-100 text-red-700',
  Flagship: 'bg-blue-100 text-blue-700',
  Production: 'bg-primary-100 text-primary-700',
  Reasoning: 'bg-purple-100 text-purple-700',
  Value: 'bg-emerald-100 text-emerald-700',
  Budget: 'bg-teal-100 text-teal-700',
  Code: 'bg-orange-100 text-orange-700',
  Open: 'bg-cyan-100 text-cyan-700',
  Free: 'bg-green-100 text-green-700',
  Legacy: 'bg-surface-100 text-surface-500',
}

export default function SettingsPage() {
  const { user, logout } = useAuthStore()
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light')
  const [profile, setProfile] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  // AI API config
  const [apiConfigs, setApiConfigs] = useState<APIConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem('campusflow-ai-configs') || '[]') } catch { return [] }
  })
  const [activeConfig, setActiveConfig] = useState<string>(() => localStorage.getItem('campusflow-active-ai') || '')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, 'success' | 'error' | 'testing'>>({})

  useEffect(() => { userAPI.getProfile().then(setProfile).catch(console.error) }, [])

  useEffect(() => {
    localStorage.setItem('campusflow-ai-configs', JSON.stringify(apiConfigs))
  }, [apiConfigs])

  useEffect(() => {
    localStorage.setItem('campusflow-active-ai', activeConfig)
  }, [activeConfig])

  const handleSaveProfile = async () => {
    setSaving(true)
    try { await userAPI.updateProfile(profile); toast.success('Profile saved!') } catch { toast.error('Failed to save') }
    setSaving(false)
  }

  const handleAddAPI = (provider: AIProvider, apiKey: string, model: string) => {
    const existing = apiConfigs.find((c) => c.provider === provider.id)
    if (existing) {
      setApiConfigs((prev) => prev.map((c) => c.provider === provider.id ? { ...c, apiKey, model, baseUrl: provider.baseUrl } : c))
    } else {
      const newConfig: APIConfig = { provider: provider.id, apiKey, model, baseUrl: provider.baseUrl, enabled: true }
      setApiConfigs((prev) => [...prev, newConfig])
    }
    if (!activeConfig || !apiConfigs.find((c) => c.provider === activeConfig)) {
      setActiveConfig(provider.id)
    }
    setAddModalOpen(false)
    setSelectedProvider(null)
    toast.success(`${provider.name} API added!`)
  }

  const handleRemoveAPI = (providerId: string) => {
    if (!confirm('Remove this API key?')) return
    setApiConfigs((prev) => prev.filter((c) => c.provider !== providerId))
    if (activeConfig === providerId) setActiveConfig('')
    toast.success('API removed')
  }

  const handleTestAPI = async (config: APIConfig) => {
    setTestResults((prev) => ({ ...prev, [config.provider]: 'testing' }))
    try {
      const provider = aiProviders.find((p) => p.id === config.provider)
      if (!provider) throw new Error('Unknown provider')

      if (provider.id === 'groq') {
        const resp = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 }),
        })
        if (!resp.ok) throw new Error('API key invalid')
      } else if (provider.id === 'openai') {
        const resp = await fetch(`${config.baseUrl}/models`, {
          headers: { 'Authorization': `Bearer ${config.apiKey}` },
        })
        if (!resp.ok) throw new Error('API key invalid')
      } else if (provider.id === 'anthropic') {
        const resp = await fetch(`${config.baseUrl}/messages`, {
          method: 'POST',
          headers: { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, max_tokens: 5, messages: [{ role: 'user', content: 'Say ok' }] }),
        })
        if (!resp.ok) throw new Error('API key invalid')
      } else {
        // Generic OpenAI-compatible test
        const resp = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: 'Say ok' }], max_tokens: 5 }),
        })
        if (!resp.ok) throw new Error('API key invalid')
      }
      setTestResults((prev) => ({ ...prev, [config.provider]: 'success' }))
      toast.success('API connection successful!')
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [config.provider]: 'error' }))
      toast.error(`Test failed: ${err.message}`)
    }
  }

  const toggleShowKey = (provider: string) => setShowKey((prev) => ({ ...prev, [provider]: !prev[provider] }))

  const maskKey = (key: string) => {
    if (!key || key.length < 10) return key
    return key.substring(0, 6) + '••••••••' + key.substring(key.length - 4)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-500 mt-1">Manage your account, AI models, and preferences</p>
      </motion.div>

      {/* Profile */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-surface-900">Profile</h2>
            <Badge variant="primary">{user?.role || 'Student'}</Badge>
          </div>
          <div className="flex items-center gap-5 mb-8 p-4 bg-surface-50 rounded-2xl">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white text-2xl font-bold shadow-lg">{user?.name?.charAt(0) || 'A'}</div>
              <button className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border-2 border-surface-200 rounded-xl flex items-center justify-center text-surface-500 hover:text-primary-600 hover:border-primary-300 transition-colors shadow-sm"><Camera size={14} /></button>
            </div>
            <div>
              <h3 className="font-bold text-surface-900 text-lg">{user?.name || 'Alex Johnson'}</h3>
              <p className="text-sm text-surface-500">{user?.email || 'alex@university.edu'}</p>
              <p className="text-xs text-surface-400 mt-1">{user?.department?.name || 'No department'}</p>
              {(user?.studentId || user?.empNumber) && (
                <p className="text-xs text-surface-400 mt-0.5">
                  {user?.role === 'STUDENT' ? `Roll No: ${user.studentId}` : `Emp No: ${user.empNumber}`}
                </p>
              )}
              {user?.college?.name && (
                <p className="text-xs text-surface-400 mt-0.5">{user.college.name}</p>
              )}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <Input label="Full Name" defaultValue={user?.name || 'Alex Johnson'} icon={<User size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, name: e.target.value }))} />
            <Input label="Department" defaultValue={user?.department?.name || ''} icon={<Building2 size={18} />} disabled />
            <Input label="Roll No / Emp No" defaultValue={user?.studentId || user?.empNumber || ''} icon={<GraduationCap size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, studentId: e.target.value }))} disabled />
            <Input label="College Name" defaultValue={user?.college?.name || ''} icon={<Building2 size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, collegeName: e.target.value }))} disabled />
          </div>
          <div className="mt-6 flex justify-end"><Button onClick={handleSaveProfile} loading={saving}><Save size={16} /> Save Changes</Button></div>
        </Card>
      </motion.div>

      {/* Chatbot AI Provider */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border-2 border-primary-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-md"><Brain className="w-5 h-5 text-white" /></div>
              <div>
                <h2 className="text-lg font-bold text-surface-900">Chatbot & AI Features</h2>
                <p className="text-xs text-surface-400">Provider for chat, study plans, daily summary</p>
              </div>
            </div>
            <Button size="sm" onClick={() => { setAddModalOpen(true); setSelectedProvider(null) }}><Plus size={16} /> Add API</Button>
          </div>

          {apiConfigs.length === 0 ? (
            <div className="mt-4 p-8 bg-surface-50 rounded-2xl text-center border border-dashed border-surface-200">
              <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><Key size={24} className="text-primary-500" /></div>
              <p className="text-surface-700 font-semibold mb-1">No AI API configured</p>
              <p className="text-sm text-surface-400 mb-4">Add your first API key to power the AI features</p>
              <Button size="sm" onClick={() => setAddModalOpen(true)}><Plus size={16} /> Add Your First API</Button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {apiConfigs.map((config) => {
                const provider = aiProviders.find((p) => p.id === config.provider)
                if (!provider) return null
                const isActive = activeConfig === config.provider
                const testStatus = testResults[config.provider]

                return (
                  <motion.div key={config.provider} layout className={`relative p-4 rounded-xl border-2 transition-all ${isActive ? 'border-primary-400 bg-primary-50/50 shadow-sm' : 'border-surface-100 hover:border-surface-200 bg-white'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl ${provider.color} flex items-center justify-center text-xl shrink-0`}>{provider.logo}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-surface-900">{provider.name}</p>
                          {isActive && <Badge variant="primary">Active</Badge>}
                          {testStatus === 'success' && <Badge variant="success">Connected</Badge>}
                          {testStatus === 'error' && <Badge variant="danger">Failed</Badge>}
                        </div>
                        <p className="text-xs text-surface-400 mt-0.5">{provider.description}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-xs text-surface-500 font-medium">Model:</span>
                          <span className="text-xs bg-surface-100 px-2 py-0.5 rounded font-mono">{provider.models.find((m) => m.id === config.model)?.name || config.model}</span>
                          <span className="text-xs text-surface-400">·</span>
                          <span className="text-xs text-surface-400 font-mono">{maskKey(config.apiKey)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => toggleShowKey(config.provider)} className="p-2 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors" title={showKey[config.provider] ? 'Hide key' : 'Show key'}>
                          {showKey[config.provider] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button onClick={() => handleTestAPI(config)} disabled={testStatus === 'testing'} className="p-2 rounded-lg text-surface-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Test connection">
                          {testStatus === 'testing' ? <div className="w-3.5 h-3.5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" /> : <Zap size={14} />}
                        </button>
                        {!isActive && (
                          <button onClick={() => setActiveConfig(config.provider)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-600 hover:bg-primary-50 transition-colors" title="Set as active">Set Active</button>
                        )}
                        <button onClick={() => handleRemoveAPI(config.provider)} className="p-2 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Remove"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {showKey[config.provider] && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 p-3 bg-surface-100 rounded-lg">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono text-surface-700 break-all flex-1">{config.apiKey}</code>
                          <button onClick={() => { navigator.clipboard.writeText(config.apiKey); toast.success('Copied!') }} className="p-1.5 rounded text-surface-400 hover:text-primary-600"><Copy size={12} /></button>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          )}

          {/* Quick Stats */}
          {apiConfigs.length > 0 && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="p-3 bg-surface-50 rounded-xl text-center">
                <p className="text-lg font-bold text-primary-600">{apiConfigs.length}</p>
                <p className="text-[10px] text-surface-400 font-medium">APIs Connected</p>
              </div>
              <div className="p-3 bg-surface-50 rounded-xl text-center">
                <p className="text-lg font-bold text-emerald-600">{Object.values(testResults).filter((v) => v === 'success').length}</p>
                <p className="text-[10px] text-surface-400 font-medium">Verified</p>
              </div>
              <div className="p-3 bg-surface-50 rounded-xl text-center">
                <p className="text-lg font-bold text-surface-700">{activeConfig ? '1' : '0'}</p>
                <p className="text-[10px] text-surface-400 font-medium">Active</p>
              </div>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Notifications */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center"><Bell className="w-5 h-5 text-primary-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Notifications</h2>
          </div>
          <div className="space-y-4">
            {[
              { label: 'Assignment Deadlines', desc: 'Get notified before deadlines', checked: true },
              { label: 'Exam Updates', desc: 'Schedule changes and announcements', checked: true },
              { label: 'Event Reminders', desc: 'Campus events and activities', checked: true },
              { label: 'Attendance Alerts', desc: 'Low attendance warnings', checked: true },
              { label: 'AI Daily Summary', desc: 'Morning briefing of your day', checked: true },
            ].map((n) => (
              <div key={n.label} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-50 transition-colors">
                <div><p className="text-sm font-semibold text-surface-900">{n.label}</p><p className="text-xs text-surface-400">{n.desc}</p></div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={n.checked} className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-200 peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
                </label>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Appearance */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center"><Palette className="w-5 h-5 text-accent-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Appearance</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[{ value: 'light', icon: Sun, label: 'Light' }, { value: 'dark', icon: Moon, label: 'Dark' }, { value: 'system', icon: Monitor, label: 'System' }].map((t) => (
              <button key={t.value} onClick={() => setTheme(t.value as any)} className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${theme === t.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-200 hover:border-surface-300 text-surface-600'}`}>
                <t.icon size={24} /><span className="text-sm font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Integrations */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Link2 className="w-5 h-5 text-emerald-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Integrations</h2>
          </div>
          <div className="space-y-3">
            {[
              { name: 'Google Calendar', icon: '📅', connected: false, color: 'bg-blue-100' },
              { name: 'LMS (Moodle)', icon: '📚', connected: false, color: 'bg-orange-100' },
              { name: 'Gmail', icon: '✉️', connected: false, color: 'bg-red-100' },
              { name: 'WhatsApp', icon: '💬', connected: false, color: 'bg-green-100' },
            ].map((i) => (
              <div key={i.name} className="flex items-center justify-between p-4 rounded-xl border border-surface-100 hover:border-surface-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${i.color} flex items-center justify-center text-lg`}>{i.icon}</div>
                  <div><p className="text-sm font-semibold text-surface-900">{i.name}</p><p className="text-xs text-surface-400">{i.connected ? 'Connected' : 'Not connected'}</p></div>
                </div>
                <button className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${i.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>{i.connected ? 'Connected' : 'Connect'}</button>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Sign Out */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-red-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><LogOut className="w-5 h-5 text-red-600" /></div>
              <div><h3 className="font-bold text-surface-900">Sign Out</h3><p className="text-xs text-surface-400">Sign out from all devices</p></div>
            </div>
            <Button variant="danger" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </Card>
      </motion.div>

      {/* Add API Modal */}
      <Modal open={addModalOpen} onClose={() => { setAddModalOpen(false); setSelectedProvider(null) }} title="Add AI API" size="lg">
        {!selectedProvider ? (
          <div className="space-y-4">
            <p className="text-sm text-surface-500">Select your AI provider</p>
            <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-1">
              {aiProviders.map((p) => {
                const isAdded = apiConfigs.some((c) => c.provider === p.id)
                return (
                  <button key={p.id} onClick={() => setSelectedProvider(p.id)}
                    className={`relative flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover:shadow-md ${isAdded ? 'border-primary-300 bg-primary-50/30' : 'border-surface-100 hover:border-primary-200'}`}>
                    <div className={`w-10 h-10 rounded-xl ${p.color} flex items-center justify-center text-lg shrink-0`}>{p.logo}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-surface-900">{p.name}</p>
                        {isAdded && <Check size={12} className="text-primary-500" />}
                      </div>
                      <p className="text-xs text-surface-400 mt-0.5 line-clamp-2">{p.description}</p>
                      {p.freeTier && <p className="text-[10px] text-emerald-600 mt-1 font-medium">✨ {p.freeTier}</p>}
                    </div>
                    <ExternalLink size={12} className="text-surface-300 shrink-0 mt-1" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <AddAPIForm provider={aiProviders.find((p) => p.id === selectedProvider)!} onAdd={handleAddAPI} onBack={() => setSelectedProvider(null)} existingConfig={apiConfigs.find((c) => c.provider === selectedProvider)} />
        )}
      </Modal>
    </motion.div>
  )
}

function AddAPIForm({ provider, onAdd, onBack, existingConfig }: { provider: AIProvider; onAdd: (provider: AIProvider, key: string, model: string) => void; onBack: () => void; existingConfig?: APIConfig }) {
  const [apiKey, setApiKey] = useState(existingConfig?.apiKey || '')
  const [selectedModel, setSelectedModel] = useState(existingConfig?.model || provider.models[0].id)
  const [showKey, setShowKey] = useState(false)
  const isCustom = provider.id === 'other'

  // Custom provider fields
  const [customName, setCustomName] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState(existingConfig?.baseUrl || '')
  const [customModel, setCustomModel] = useState('')

  const handleCustomAdd = () => {
    const customProvider: AIProvider = {
      ...provider,
      id: `custom-${Date.now()}`,
      name: customName || 'Custom API',
      baseUrl: customBaseUrl,
      models: [{ id: customModel || 'custom', name: customModel || 'Custom', tier: 'Custom', pricing: 'Varies', context: 'Varies' }],
    }
    onAdd(customProvider, apiKey, customModel || 'custom')
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-surface-500 hover:text-primary-600 transition-colors">
        <ChevronRight size={14} className="rotate-180" /> Back to providers
      </button>

      <div className={`flex items-center gap-4 p-4 rounded-xl border ${provider.color.split(' ').slice(0, 2).join(' ')}`}>
        <div className={`w-12 h-12 rounded-xl ${provider.color} flex items-center justify-center text-2xl`}>{provider.logo}</div>
        <div>
          <p className="font-bold text-surface-900 text-lg">{provider.name}</p>
          <p className="text-xs text-surface-500">{provider.description}</p>
          {provider.website && (
            <a href={provider.website} target="_blank" rel="noopener" className="text-xs text-primary-600 hover:underline mt-1 inline-flex items-center gap-1">
              Get API key <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {isCustom ? (
        <>
          {/* Custom provider: ask for everything */}
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">Display Name</label>
            <input type="text" value={customName} onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. My Self-Hosted LLM"
              className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">Base URL <span className="text-red-400">*</span></label>
            <input type="text" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1 or https://your-api.com/v1"
              className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm font-mono text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" />
            <p className="text-[11px] text-surface-400 mt-1">Must be an OpenAI-compatible endpoint</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">Model Name <span className="text-red-400">*</span></label>
            <input type="text" value={customModel} onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. llama3.3:70b, mistral-7b, my-fine-tuned-model"
              className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm font-mono text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all" />
          </div>
        </>
      ) : (
        <>
          {/* Standard providers: model selection */}
          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-2">Select Model</label>
            <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
              {provider.models.map((m) => (
                <button key={m.id} onClick={() => setSelectedModel(m.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${selectedModel === m.id ? 'border-primary-400 bg-primary-50' : 'border-surface-100 hover:border-surface-200'}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-surface-900">{m.name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tierColors[m.tier] || 'bg-surface-100 text-surface-500'}`}>{m.tier}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-surface-400">{m.pricing}</span>
                      <span className="text-xs text-surface-300">·</span>
                      <span className="text-xs text-surface-400">{m.context} context</span>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedModel === m.id ? 'border-primary-500 bg-primary-500' : 'border-surface-300'}`}>
                    {selectedModel === m.id && <Check size={10} className="text-white" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* API Key Input */}
      <div>
        <label className="block text-sm font-semibold text-surface-700 mb-1.5">API Key</label>
        <div className="relative">
          <input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.keyPrefix ? `Starts with ${provider.keyPrefix}` : 'Enter your API key (or leave empty for local)'}
            className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm font-mono text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all pr-20" />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button onClick={() => setShowKey(!showKey)} className="p-1.5 rounded-lg text-surface-400 hover:text-surface-600 hover:bg-surface-100 transition-colors">
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        {provider.keyPrefix && !apiKey.startsWith(provider.keyPrefix) && apiKey.length > 0 && (
          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertCircle size={10} /> Key usually starts with "{provider.keyPrefix}"</p>
        )}
      </div>

      <div className="p-3 bg-surface-50 rounded-xl flex items-start gap-2">
        <Shield size={14} className="text-surface-400 mt-0.5 shrink-0" />
        <p className="text-xs text-surface-400">Your API key is stored only in your browser's local storage. It is never sent to our servers.</p>
      </div>

      {isCustom ? (
        <Button onClick={handleCustomAdd} disabled={!customBaseUrl.trim() || !customModel.trim()} className="w-full" size="lg">
          <Key size={16} /> Add Custom Provider
        </Button>
      ) : (
        <Button onClick={() => onAdd(provider, apiKey, selectedModel)} disabled={!apiKey.trim()} className="w-full" size="lg">
          <Key size={16} /> {existingConfig ? 'Update' : 'Add'} {provider.name} API
        </Button>
      )}
    </div>
  )
}

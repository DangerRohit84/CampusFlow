import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import type { AiProvider } from '../../types/api'

interface Props {
  open: boolean
  provider?: AiProvider | null
  onSave: (data: any) => Promise<void>
  onClose: () => void
}

const TYPES = [
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
]

export default function ProviderModal({ open, provider, onSave, onClose }: Props) {
  const [form, setForm] = useState({
    name: '', baseUrl: '', apiKey: '', model: '', type: 'openai-compatible', headers: [] as { key: string; value: string }[],
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (provider) {
      setForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: '',
        model: provider.model,
        type: provider.type,
        headers: provider.headers ? JSON.parse(provider.headers) : [],
      })
    } else {
      setForm({ name: '', baseUrl: '', apiKey: '', model: '', type: 'openai-compatible', headers: [] })
    }
  }, [provider, open])

  const handleSubmit = async () => {
    setSaving(true)
    await onSave({
      ...form,
      headers: form.headers.length > 0 ? JSON.stringify(form.headers) : undefined,
      apiKey: form.apiKey || undefined,
    })
    setSaving(false)
    onClose()
  }

  const addHeader = () => setForm(f => ({ ...f, headers: [...f.headers, { key: '', value: '' }] }))
  const removeHeader = (i: number) => setForm(f => ({ ...f, headers: f.headers.filter((_, idx) => idx !== i) }))
  const updateHeader = (i: number, field: 'key' | 'value', val: string) =>
    setForm(f => ({ ...f, headers: f.headers.map((h, idx) => idx === i ? { ...h, [field]: val } : h) }))

  return (
    <Modal open={open} onClose={onClose} title={provider ? 'Edit Provider' : 'Add Provider'} size="lg">
      <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="My OpenAI key"
            autoComplete="off"
          />
          <Input
            label="Base URL"
            value={form.baseUrl}
            onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
            placeholder="https://api.openai.com/v1"
            inputMode="url"
            autoComplete="url"
          />
          <Input
            label={provider ? 'API Key (leave blank to keep current)' : 'API Key'}
            type="password"
            value={form.apiKey}
            onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
            placeholder="sk-…"
            autoComplete="new-password"
          />
          <Input
            label="Model"
            value={form.model}
            onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
            placeholder="gpt-4o-mini"
            autoComplete="off"
          />
          <div>
            <label htmlFor="provider-type" className="block text-sm font-medium text-surface-700 dark:text-night-200 mb-1">Type</label>
            <select id="provider-type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 min-h-[44px] rounded-lg border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label id="custom-headers-label" className="text-sm font-medium text-surface-700 dark:text-night-200">Custom Headers</label>
              <button type="button" onClick={addHeader} aria-label="Add custom header" className="min-h-[44px] px-3 inline-flex items-center gap-1 text-xs text-primary-700 dark:text-success-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 rounded-lg">
                <Plus size={12} aria-hidden="true" /> Add
              </button>
            </div>
            {form.headers.map((h, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input aria-label={`Custom header ${i + 1} key`} placeholder="Key" value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)}
                  className="flex-1 px-3 py-1.5 min-h-[44px] rounded-lg border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 text-sm placeholder:text-[#6b7280]" />
                <input aria-label={`Custom header ${i + 1} value`} placeholder="Value" value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)}
                  className="flex-1 px-3 py-1.5 min-h-[44px] rounded-lg border border-surface-200 dark:border-night-600 bg-surface-50 dark:bg-night-850 text-surface-900 dark:text-night-50 text-sm placeholder:text-[#6b7280]" />
                <button type="button" onClick={() => removeHeader(i)} aria-label={`Remove custom header ${i + 1}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 dark:bg-success-300 dark:hover:bg-success-200 text-white flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {provider ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
    </Modal>
  )
}

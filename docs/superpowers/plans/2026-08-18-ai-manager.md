# AI Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI Manager page for super admins to manage AI providers, route features to providers with fallback chains, and visualize connections.

**Architecture:** New Prisma models (AiProvider, AiRouting) with AES-256 encryption for API keys. Backend routes for CRUD, testing, and routing. Frontend with provider cards, routing table, and SVG graph. All routes protected by SUPER_ADMIN authorization.

**Tech Stack:** Express, Prisma, AES-256-GCM (Node crypto), React, Zustand, SVG, Tailwind CSS

## Global Constraints

- Node.js 18+
- AES-256-GCM encryption for API keys
- `AI_ENCRYPTION_KEY` env var required (32+ chars)
- All `/api/ai/*` routes: `authorize(['SUPER_ADMIN'])`
- Frontend uses `api` axios instance (not raw fetch)
- Dark mode: exact palette classes (`dark:bg-[#111920]`, `dark:text-[#F4F7F8]`, etc.)
- Built-in providers: `isBuiltIn: true`, cannot be deleted

---

## File Structure

### Backend (Create)
| File | Responsibility |
|------|---------------|
| `packages/backend/src/utils/encryption.ts` | AES-256-GCM encrypt/decrypt/mask functions |
| `packages/backend/src/services/ai-manager.ts` | Business logic: CRUD, test, routing |
| `packages/backend/src/routes/ai-manager.ts` | Express routes for providers and routing |

### Backend (Modify)
| File | Change |
|------|--------|
| `packages/backend/prisma/schema.prisma` | Add AiProvider, AiRouting models |
| `packages/backend/src/index.ts` | Register ai-manager routes |
| `packages/backend/.env.example` | Add AI_ENCRYPTION_KEY |
| `packages/backend/prisma/seed.ts` | Seed built-in providers |

### Frontend (Create)
| File | Responsibility |
|------|---------------|
| `apps/web/src/pages/AiManagerPage.tsx` | Main page layout |
| `apps/web/src/components/ai/ProviderCard.tsx` | Provider card with toggle, test, delete |
| `apps/web/src/components/ai/ProviderModal.tsx` | Add/edit provider modal |
| `apps/web/src/components/ai/RoutingTable.tsx` | Feature routing dropdowns |
| `apps/web/src/components/ai/AiGraph.tsx` | SVG visual graph |
| `apps/web/src/components/ai/TestConnectionButton.tsx` | Test connection button |

### Frontend (Modify)
| File | Change |
|------|--------|
| `apps/web/src/App.tsx` | Add `/admin/ai-manager` route |
| `apps/web/src/components/layout/Layout.tsx` | Add AI Manager to sidebar |

---

### Task 1: Encryption Utils

**Files:**
- Create: `packages/backend/src/utils/encryption.ts`

**Interfaces:**
- Produces: `encryptApiKey(plain: string): string`, `decryptApiKey(cipher: string): string`, `maskApiKey(cipher: string): string`

- [ ] **Step 1: Create encryption.ts**

```typescript
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const key = process.env.AI_ENCRYPTION_KEY
  if (!key || key.length < 32) {
    throw new Error('AI_ENCRYPTION_KEY env var must be at least 32 characters')
  }
  return Buffer.from(key.slice(0, 32), 'utf-8')
}

export function encryptApiKey(plain: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptApiKey(cipher: string): string {
  const key = getEncryptionKey()
  const [ivHex, authTagHex, encryptedHex] = cipher.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf-8')
}

export function maskApiKey(cipher: string): string {
  try {
    const plain = decryptApiKey(cipher)
    if (plain.length <= 4) return '****'
    return `${plain.slice(0, 3)}...${plain.slice(-4)}`
  } catch {
    return '****'
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/encryption.ts
git commit -m "feat(ai-manager): add AES-256-GCM encryption utils for API keys"
```

---

### Task 2: Prisma Schema + Seed

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Modify: `packages/backend/prisma/seed.ts`
- Modify: `packages/backend/.env.example`

**Interfaces:**
- Produces: `AiProvider`, `AiRouting` Prisma models, seeded built-in providers

- [ ] **Step 1: Add models to schema.prisma**

Add before the closing `}` of the schema:

```prisma
model AiProvider {
  id            String   @id @default(cuid())
  name          String
  baseUrl       String
  apiKey        String
  model         String
  type          String   @default("openai-compatible")
  headers       String?
  enabled       Boolean  @default(true)
  isBuiltIn     Boolean  @default(false)
  collegeId     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([name, collegeId])
}

model AiRouting {
  id            String   @id @default(cuid())
  feature       String
  providerId    String
  fallbackOrder Int
  collegeId     String?
  createdAt     DateTime @default(now())

  @@unique([feature, fallbackOrder, collegeId])
}
```

- [ ] **Step 2: Add AI_ENCRYPTION_KEY to .env.example**

Append to `packages/backend/.env.example`:

```
# AI Manager - API key encryption (min 32 chars)
AI_ENCRYPTION_KEY=your-secret-encryption-key-at-least-32-chars
```

- [ ] **Step 3: Add seed logic for built-in providers**

Append to `packages/backend/prisma/seed.ts`:

```typescript
// AI Manager - seed built-in providers
const BUILTIN_PROVIDERS = [
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', type: 'openai-compatible' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', type: 'openai-compatible' },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514', type: 'anthropic' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash', type: 'google' },
  { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', type: 'openai-compatible' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', type: 'openai-compatible' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3', type: 'openai-compatible' },
  { name: 'OpenCode Serve', baseUrl: 'http://localhost:8081/v1', model: 'default', type: 'openai-compatible' },
]

for (const p of BUILTIN_PROVIDERS) {
  await prisma.aiProvider.upsert({
    where: { name_collegeId: { name: p.name, collegeId: null } },
    update: {},
    create: { ...p, apiKey: 'placeholder', isBuiltIn: true, enabled: false },
  })
}
```

- [ ] **Step 4: Run prisma db push**

Run: `cd packages/backend && npx prisma db push`
Expected: Models created successfully

- [ ] **Step 5: Commit**

```bash
git add packages/backend/prisma/schema.prisma packages/backend/prisma/seed.ts packages/backend/.env.example
git commit -m "feat(ai-manager): add AiProvider and AiRouting Prisma models with seed data"
```

---

### Task 3: Backend Service

**Files:**
- Create: `packages/backend/src/services/ai-manager.ts`

**Interfaces:**
- Consumes: `encryptApiKey`, `decryptApiKey`, `maskApiKey` from `../utils/encryption`
- Produces: `getProviders()`, `createProvider()`, `updateProvider()`, `deleteProvider()`, `toggleProvider()`, `testProvider()`, `getRouting()`, `updateRouting()`

- [ ] **Step 1: Create ai-manager.ts**

```typescript
import { PrismaClient } from '@prisma/client'
import { encryptApiKey, decryptApiKey, maskApiKey } from '../utils/encryption'

const prisma = new PrismaClient()

export async function getProviders() {
  const providers = await prisma.aiProvider.findMany({ orderBy: { name: 'asc' } })
  return providers.map(p => ({
    ...p,
    apiKey: maskApiKey(p.apiKey),
  }))
}

export async function createProvider(data: {
  name: string; baseUrl: string; apiKey: string; model: string
  type?: string; headers?: string; collegeId?: string
}) {
  const encrypted = encryptApiKey(data.apiKey)
  const provider = await prisma.aiProvider.create({
    data: { ...data, apiKey: encrypted },
  })
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

export async function updateProvider(id: string, data: {
  name?: string; baseUrl?: string; apiKey?: string; model?: string
  type?: string; headers?: string
}) {
  const updateData: any = { ...data }
  if (data.apiKey) updateData.apiKey = encryptApiKey(data.apiKey)
  const provider = await prisma.aiProvider.update({ where: { id }, data: updateData })
  return { ...provider, apiKey: maskApiKey(provider.apiKey) }
}

export async function deleteProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (provider?.isBuiltIn) throw new Error('Cannot delete built-in provider')
  await prisma.aiRouting.deleteMany({ where: { providerId: id } })
  await prisma.aiProvider.delete({ where: { id } })
}

export async function toggleProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (!provider) throw new Error('Provider not found')
  const updated = await prisma.aiProvider.update({
    where: { id },
    data: { enabled: !provider.enabled },
  })
  return { ...updated, apiKey: maskApiKey(updated.apiKey) }
}

export async function testProvider(id: string) {
  const provider = await prisma.aiProvider.findUnique({ where: { id } })
  if (!provider) throw new Error('Provider not found')
  const apiKey = decryptApiKey(provider.apiKey)
  const start = Date.now()

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...JSON.parse(provider.headers || '{}'),
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'user', content: 'Say "Hello! I am working correctly."' }],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      const err = await response.text()
      return { success: false, error: `HTTP ${response.status}: ${err}`, latency: Date.now() - start }
    }

    const data = await response.json() as any
    const text = data.choices?.[0]?.message?.content || 'No response'
    return { success: true, latency: Date.now() - start, model: provider.model, response: text }
  } catch (err: any) {
    return { success: false, error: err.message || 'Connection failed', latency: Date.now() - start }
  }
}

export async function getRouting() {
  const routing = await prisma.aiRouting.findMany()
  return routing
}

export async function updateRouting(feature: string, providerIds: (string | null)[]) {
  await prisma.aiRouting.deleteMany({ where: { feature } })
  const creates = providerIds
    .map((providerId, index) => providerId ? { feature, providerId, fallbackOrder: index } : null)
    .filter(Boolean)
  if (creates.length > 0) {
    await prisma.aiRouting.createMany({ data: creates as any })
  }
}

export function getDecryptedKey(id: string): Promise<string> {
  return prisma.aiProvider.findUnique({ where: { id } }).then(p => {
    if (!p) throw new Error('Provider not found')
    return decryptApiKey(p.apiKey)
  })
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/ai-manager.ts
git commit -m "feat(ai-manager): add backend service for provider CRUD, testing, and routing"
```

---

### Task 4: Backend Routes

**Files:**
- Create: `packages/backend/src/routes/ai-manager.ts`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**
- Consumes: All functions from `../services/ai-manager`
- Produces: Mounted Express router at `/api/ai`

- [ ] **Step 1: Create ai-manager.ts routes**

```typescript
import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth'
import * as aiManager from '../services/ai-manager'

const router = Router()

router.use(authenticate)
router.use(authorize(['SUPER_ADMIN']))

// Providers
router.get('/providers', async (req, res) => {
  const providers = await aiManager.getProviders()
  res.json({ providers })
})

router.post('/providers', async (req, res) => {
  const provider = await aiManager.createProvider(req.body)
  res.json(provider)
})

router.put('/providers/:id', async (req, res) => {
  const provider = await aiManager.updateProvider(req.params.id, req.body)
  res.json(provider)
})

router.delete('/providers/:id', async (req, res) => {
  await aiManager.deleteProvider(req.params.id)
  res.json({ success: true })
})

router.patch('/providers/:id/toggle', async (req, res) => {
  const provider = await aiManager.toggleProvider(req.params.id)
  res.json(provider)
})

router.post('/providers/:id/test', async (req, res) => {
  const result = await aiManager.testProvider(req.params.id)
  res.json(result)
})

// Routing
router.get('/routing', async (req, res) => {
  const routing = await aiManager.getRouting()
  res.json({ routing })
})

router.put('/routing', async (req, res) => {
  const { feature, providerIds } = req.body
  await aiManager.updateRouting(feature, providerIds)
  res.json({ success: true })
})

export default router
```

- [ ] **Step 2: Register route in index.ts**

Find the line `import fetchRoutes from './routes/fetch'` in `packages/backend/src/index.ts` and add:

```typescript
import aiManagerRoutes from './routes/ai-manager'
```

Find `app.use('/api/fetch', fetchRoutes)` and add after it:

```typescript
app.use('/api/ai', aiManagerRoutes)
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/ai-manager.ts packages/backend/src/index.ts
git commit -m "feat(ai-manager): add backend routes for providers and routing"
```

---

### Task 5: Frontend — ProviderCard Component

**Files:**
- Create: `apps/web/src/components/ai/ProviderCard.tsx`

**Interfaces:**
- Consumes: Provider type from API response
- Produces: `<ProviderCard provider onEdit onToggle onDelete onTest />`

- [ ] **Step 1: Create ProviderCard.tsx**

```tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, Pencil, Trash2, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react'
import type { AiProvider } from '../../types/api'

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
      await onTest(provider.id)
      setTestResult({ ok: true, msg: 'Connected!' })
    } catch {
      setTestResult({ ok: false, msg: 'Failed' })
    }
    setTesting(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 ${
        provider.enabled
          ? 'bg-surface-50 border-surface-200 dark:bg-[#111920] dark:border-[#202C35]'
          : 'bg-surface-100 border-surface-200 opacity-60 dark:bg-[#0C1218] dark:border-[#202C35]'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${provider.enabled ? 'bg-green-500' : 'bg-gray-400'}`} />
          <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">{provider.name}</h3>
        </div>
        <button
          onClick={() => onToggle(provider.id)}
          className="text-surface-500 hover:text-primary-600 dark:text-[#71808C] dark:hover:text-[#00A88F]"
        >
          {provider.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
        </button>
      </div>

      <p className="text-sm text-surface-600 dark:text-[#71808C] mb-2 truncate">{provider.baseUrl}</p>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs px-2 py-0.5 rounded-full bg-surface-200 text-surface-700 dark:bg-[#151F27] dark:text-[#A6B3BE]">
          {provider.model}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[provider.type] || ''}`}>
          {provider.type}
        </span>
      </div>

      <p className="text-xs text-surface-500 dark:text-[#71808C] font-mono mb-3">{provider.apiKey}</p>

      {testResult && (
        <p className={`text-xs mb-2 ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
          {testResult.msg}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 dark:bg-[#151F27] dark:hover:bg-[#202C35] text-surface-700 dark:text-[#A6B3BE]"
        >
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
          Test
        </button>
        <button
          onClick={() => onEdit(provider)}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-surface-200 hover:bg-surface-300 dark:bg-[#151F27] dark:hover:bg-[#202C35] text-surface-700 dark:text-[#A6B3BE]"
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
```

- [ ] **Step 2: Add AiProvider type to api.ts**

Add to `apps/web/src/types/api.ts`:

```typescript
export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  type: string
  headers: string | null
  enabled: boolean
  isBuiltIn: boolean
  collegeId: string | null
  createdAt: string
  updatedAt: string
}

export interface AiRouting {
  id: string
  feature: string
  providerId: string
  fallbackOrder: number
  collegeId: string | null
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ai/ProviderCard.tsx apps/web/src/types/api.ts
git commit -m "feat(ai-manager): add ProviderCard component with toggle, test, and delete"
```

---

### Task 6: Frontend — ProviderModal Component

**Files:**
- Create: `apps/web/src/components/ai/ProviderModal.tsx`

**Interfaces:**
- Consumes: AiProvider type
- Produces: `<ProviderModal open provider onSave onClose />`

- [ ] **Step 1: Create ProviderModal.tsx**

```tsx
import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Loader2 } from 'lucide-react'
import Modal from '../ui/Modal'
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
    <Modal open={open} onClose={onClose}>
      <div className="p-6 max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-[#F4F7F8]">
            {provider ? 'Edit Provider' : 'Add Provider'}
          </h2>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-700 dark:text-[#71808C]">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-[#A6B3BE] mb-1">Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-[#A6B3BE] mb-1">Base URL</label>
            <input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-[#A6B3BE] mb-1">
              API Key {provider && <span className="text-surface-500">(leave blank to keep current)</span>}
            </label>
            <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-[#A6B3BE] mb-1">Model</label>
            <input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8]" />
          </div>
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-[#A6B3BE] mb-1">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8]">
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-surface-700 dark:text-[#A6B3BE]">Custom Headers</label>
              <button onClick={addHeader} className="text-xs text-primary-600 dark:text-[#00A88F] flex items-center gap-1">
                <Plus size={12} /> Add
              </button>
            </div>
            {form.headers.map((h, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input placeholder="Key" value={h.key} onChange={e => updateHeader(i, 'key', e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8] text-sm" />
                <input placeholder="Value" value={h.value} onChange={e => updateHeader(i, 'value', e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8] text-sm" />
                <button onClick={() => removeHeader(i)} className="text-red-500 hover:text-red-700">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-surface-200 dark:border-[#202C35] text-surface-700 dark:text-[#A6B3BE]">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 dark:bg-[#00A88F] dark:hover:bg-[#00C49A] text-white flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {provider ? 'Save Changes' : 'Add Provider'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ai/ProviderModal.tsx
git commit -m "feat(ai-manager): add ProviderModal for adding and editing providers"
```

---

### Task 7: Frontend — RoutingTable Component

**Files:**
- Create: `apps/web/src/components/ai/RoutingTable.tsx`

**Interfaces:**
- Consumes: AiRouting, AiProvider[] types
- Produces: `<RoutingTable providers routing onSave />`

- [ ] **Step 1: Create RoutingTable.tsx**

```tsx
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
  { id: 'enrichment', label: 'Enrichment', desc: 'Opportunity data enrichment' },
  { id: 'tasks', label: 'Tasks', desc: 'AI task generation' },
  { id: 'timetable', label: 'Timetable', desc: 'Schedule optimization' },
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
          <tr className="border-b border-surface-200 dark:border-[#202C35]">
            <th className="text-left py-3 px-4 text-surface-600 dark:text-[#71808C] font-medium">Feature</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-[#71808C] font-medium">Description</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-[#71808C] font-medium">Primary</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-[#71808C] font-medium">Fallback 1</th>
            <th className="text-left py-3 px-4 text-surface-600 dark:text-[#71808C] font-medium">Fallback 2</th>
            <th className="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>
          {FEATURES.map(f => (
            <tr key={f.id} className="border-b border-surface-100 dark:border-[#151F27]">
              <td className="py-3 px-4 font-medium text-surface-900 dark:text-[#F4F7F8]">{f.label}</td>
              <td className="py-3 px-4 text-surface-600 dark:text-[#71808C]">{f.desc}</td>
              {[0, 1, 2].map(order => (
                <td key={order} className="py-3 px-4">
                  <select
                    value={local[f.id]?.[order] || ''}
                    onChange={e => handleChange(f.id, order, e.target.value || null)}
                    className="w-full px-2 py-1.5 rounded-lg border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] text-surface-900 dark:text-[#F4F7F8] text-sm"
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
                  className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-[#151F27] text-primary-600 dark:text-[#00A88F]"
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ai/RoutingTable.tsx
git commit -m "feat(ai-manager): add RoutingTable component with per-feature provider selection"
```

---

### Task 8: Frontend — AiGraph Component

**Files:**
- Create: `apps/web/src/components/ai/AiGraph.tsx`

**Interfaces:**
- Consumes: AiProvider[], AiRouting[]
- Produces: `<AiGraph providers routing />`

- [ ] **Step 1: Create AiGraph.tsx**

```tsx
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

const FEATURES = ['Chat', 'Enrichment', 'Tasks', 'Timetable']

export default function AiGraph({ providers, routing }: Props) {
  const enabled = providers.filter(p => p.enabled)
  const providerY = (i: number) => 60 + i * 70
  const featureY = (i: number) => 60 + i * 70

  const lines = routing.map(r => {
    const provider = providers.find(p => p.id === r.providerId)
    if (!provider) return null
    return {
      provider,
      feature: FEATURES[r.fallbackOrder] || FEATURES[0],
      featureIdx: ['chat', 'enrichment', 'tasks', 'timetable'].indexOf(r.feature),
      primary: r.fallbackOrder === 0,
    }
  }).filter(Boolean) as { provider: AiProvider; feature: string; featureIdx: number; primary: boolean }[]

  return (
    <div className="bg-surface-50 dark:bg-[#111920] rounded-xl border border-surface-200 dark:border-[#202C35] p-4 overflow-x-auto">
      <svg viewBox={`0 0 600 ${Math.max(60, enabled.length * 70 + 40)}`} className="w-full min-w-[500px]">
        {/* Provider nodes */}
        {enabled.map((p, i) => (
          <g key={p.id}>
            <rect x={20} y={providerY(i)} width={140} height={40} rx={8}
              fill={p.enabled ? '#111920' : '#0C1218'}
              stroke={PROVIDER_COLORS[p.name] || '#A855F7'} strokeWidth={2} />
            <circle cx={36} cy={providerY(i) + 20} r={4} fill={p.enabled ? '#22C55E' : '#6B7280'} />
            <text x={48} y={providerY(i) + 25} fill={p.enabled ? '#F4F7F8' : '#71808C'} fontSize={12} fontWeight={500}>
              {p.name}
            </text>
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
          const pIdx = enabled.findIndex(p => p.id === l.provider.id)
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

        {/* Legend */}
        <line x1={20} y1={Math.max(60, enabled.length * 70 + 20)} x2={60} y2={Math.max(60, enabled.length * 70 + 20)}
          stroke="#A6B3BE" strokeWidth={2} />
        <text x={68} y={Math.max(63, enabled.length * 70 + 23)} fill="#71808C" fontSize={10}>Primary</text>
        <line x1={130} y1={Math.max(60, enabled.length * 70 + 20)} x2={170} y2={Math.max(60, enabled.length * 70 + 20)}
          stroke="#A6B3BE" strokeWidth={2} strokeDasharray="8 4" />
        <text x={178} y={Math.max(63, enabled.length * 70 + 23)} fill="#71808C" fontSize={10}>Fallback</text>
      </svg>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/ai/AiGraph.tsx
git commit -m "feat(ai-manager): add AiGraph SVG visual component for provider-feature connections"
```

---

### Task 9: Frontend — AiManagerPage

**Files:**
- Create: `apps/web/src/pages/AiManagerPage.tsx`

**Interfaces:**
- Consumes: ProviderCard, ProviderModal, RoutingTable, AiGraph components
- Produces: Complete AI Manager page

- [ ] **Step 1: Create AiManagerPage.tsx**

```tsx
import { useState, useEffect } from 'react'
import { Plus, Zap, Loader2 } from 'lucide-react'
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
      api.get('/ai/providers'),
      api.get('/ai/routing'),
    ])
    setProviders(p.data.providers)
    setRouting(r.data.routing)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSave = async (data: any) => {
    if (editing) {
      await api.put(`/ai/providers/${editing.id}`, data)
    } else {
      await api.post('/ai/providers', data)
    }
    await load()
  }

  const handleToggle = async (id: string) => {
    await api.patch(`/ai/providers/${id}/toggle`)
    await load()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this provider?')) return
    await api.delete(`/ai/providers/${id}`)
    await load()
  }

  const handleTest = async (id: string) => {
    await api.post(`/ai/providers/${id}/test`)
  }

  const handleTestAll = async () => {
    const enabled = providers.filter(p => p.enabled)
    for (const p of enabled) {
      await api.post(`/ai/providers/${p.id}/test`).catch(() => {})
    }
  }

  const handleRoutingSave = async (feature: string, providerIds: (string | null)[]) => {
    await api.put('/ai/routing', { feature, providerIds })
    await load()
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
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/AiManagerPage.tsx
git commit -m "feat(ai-manager): add AiManagerPage with provider cards, routing table, and graph"
```

---

### Task 10: Frontend — Route + Sidebar Integration

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/layout/Layout.tsx`

**Interfaces:**
- Consumes: AiManagerPage
- Produces: `/admin/ai-manager` route and sidebar entry

- [ ] **Step 1: Add route to App.tsx**

Add import after existing page imports:

```typescript
import AiManagerPage from './pages/AiManagerPage'
```

Add route inside the protected routes section (near `/admin/fetch`):

```tsx
<Route path="/admin/ai-manager" element={<AiManagerPage />} />
```

- [ ] **Step 2: Add sidebar entry to Layout.tsx**

Find the SUPER_ADMIN Management section in `navByRole` and add after the "Fetch Data" entry:

```typescript
{ path: '/admin/ai-manager', label: 'AI Manager', icon: Brain }
```

Add `Brain` to the lucide-react import at the top of the file.

- [ ] **Step 3: Verify compilation**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/layout/Layout.tsx
git commit -m "feat(ai-manager): add /admin/ai-manager route and sidebar entry for super admin"
```

---

### Task 11: Integration — Use Routing in AI Calls

**Files:**
- Modify: `packages/backend/src/services/ai-manager.ts`

**Interfaces:**
- Consumes: AiRouting, AiProvider models
- Produces: `getProviderForFeature(feature: string): Promise<{ provider, apiKey } | null>`

- [ ] **Step 1: Add getProviderForFeature to ai-manager.ts**

Add to the end of `packages/backend/src/services/ai-manager.ts`:

```typescript
export async function getProviderForFeature(feature: string): Promise<{
  baseUrl: string; apiKey: string; model: string; type: string; headers: Record<string, string>
} | null> {
  const routing = await prisma.aiRouting.findMany({
    where: { feature },
    orderBy: { fallbackOrder: 'asc' },
    include: { /* need provider */ },
  })

  for (const r of routing) {
    const provider = await prisma.aiProvider.findUnique({ where: { id: r.providerId } })
    if (provider?.enabled) {
      return {
        baseUrl: provider.baseUrl,
        apiKey: decryptApiKey(provider.apiKey),
        model: provider.model,
        type: provider.type,
        headers: JSON.parse(provider.headers || '{}'),
      }
    }
  }
  return null
}
```

- [ ] **Step 2: Add provider relation to AiRouting model**

Update `packages/backend/prisma/schema.prisma` AiRouting model:

```prisma
model AiRouting {
  id            String   @id @default(cuid())
  feature       String
  providerId    String
  provider      AiProvider @relation(fields: [providerId], references: [id])
  fallbackOrder Int
  collegeId     String?
  createdAt     DateTime @default(now())

  @@unique([feature, fallbackOrder, collegeId])
}
```

- [ ] **Step 3: Run prisma db push**

Run: `cd packages/backend && npx prisma db push`
Expected: Relation created

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit -p packages/backend/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/ai-manager.ts packages/backend/prisma/schema.prisma
git commit -m "feat(ai-manager): add getProviderForFeature with fallback chain support"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Build backend**

Run: `cd packages/backend && npx tsc`
Expected: No errors

- [ ] **Step 2: Build frontend**

Run: `cd apps/web && npm run build`
Expected: No errors

- [ ] **Step 3: Verify all files exist**

Check: All files in File Structure section exist

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "feat(ai-manager): complete AI Manager implementation"
```

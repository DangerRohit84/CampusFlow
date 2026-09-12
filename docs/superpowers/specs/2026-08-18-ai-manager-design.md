# AI Manager — Design Spec

## Overview

AI Manager is a super admin page for managing AI providers and routing features to providers with fallback chains. It provides a visual graph showing provider-to-feature connections.

## Goals

1. Manage AI providers (add, edit, remove, enable/disable)
2. Route features to specific providers with fallback chains
3. Visual graph showing connections
4. Test provider connections before assigning
5. Secure API key storage (encrypted at rest)

## Non-Goals

- Billing/usage tracking per provider (future feature)
- Rate limiting per provider
- Load balancing across providers

---

## Page Layout

Route: `/admin/ai-manager` (SUPER_ADMIN only)

```
/admin/ai-manager
│
├── Header
│   ├── Title: "AI Manager"
│   ├── Subtitle: "Manage AI providers and feature routing"
│   ├── "Add Provider" button (opens modal)
│   └── "Test All" button (tests all enabled providers)
│
├── Provider Cards Grid (2 columns on desktop, 1 on mobile)
│   └── Each card shows: name, base URL, model, masked key, toggle, test, delete
│
├── Feature Routing Table
│   └── Dropdowns per feature: Chat, Enrichment, Tasks, Timetable
│       Each has: Primary provider, Fallback 1, Fallback 2
│
└── Visual Graph (SVG)
    └── Providers on left, features on right
        Solid lines = primary, dashed lines = fallback
        Click to re-route
```

---

## Data Models

### AiProvider

Stores AI provider configurations. API keys are encrypted at rest.

```prisma
model AiProvider {
  id            String   @id @default(cuid())
  name          String   // "Groq", "OpenAI", "My Custom Provider"
  baseUrl       String   // "https://api.groq.com/openai/v1"
  apiKey        String   // encrypted with AES-256
  model         String   // "llama-3.3-70b-versatile"
  type          String   // "openai-compatible" | "anthropic" | "google"
  headers       String?  // JSON string for custom headers
  enabled       Boolean  @default(true)
  isBuiltIn     Boolean  @default(false)
  collegeId     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([name, collegeId])
}
```

### AiRouting

Maps features to providers with fallback ordering.

```prisma
model AiRouting {
  id            String   @id @default(cuid())
  feature       String   // "chat" | "enrichment" | "tasks" | "timetable"
  providerId    String
  fallbackOrder Int      // 0=primary, 1=fallback1, 2=fallback2
  collegeId     String?
  createdAt     DateTime @default(now())

  @@unique([feature, fallbackOrder, collegeId])
}
```

---

## Features

### 1. Provider Management

#### Provider Card

Each provider is displayed as a card with:

| Field | Display |
|-------|---------|
| Name | Bold text, top of card |
| Base URL | Gray text below name |
| Model | Badge with model name |
| API Key | Masked: `sk-...3x7k` |
| Status | Toggle switch (enabled/disabled) |
| Actions | Test Connection, Edit, Delete |

#### Add/Edit Provider Modal

```
┌─────────────────────────────────────────┐
│  Add AI Provider                   [X]  │
├─────────────────────────────────────────┤
│  Name:      [________________]          │
│  Base URL:  [________________]          │
│  API Key:   [________________]          │
│  Model:     [________________]          │
│  Type:      [OpenAI-compatible ▼]       │
│                                         │
│  ┌─ Default Headers (optional) ───────┐ │
│  │ Key: [________] Val: [________] [+]│ │
│  └────────────────────────────────────┘ │
│                                         │
│         [Test]  [Cancel]  [Save]        │
└─────────────────────────────────────────┘
```

Fields:
- **Name** — Display name (required)
- **Base URL** — API endpoint (required)
- **API Key** — Secret key (required, encrypted on save)
- **Model** — Model identifier (required)
- **Type** — Provider type dropdown: OpenAI-compatible, Anthropic, Google
- **Headers** — Optional key-value pairs for custom headers

#### Pre-configured Providers

These providers are pre-seeded in the database:

| Name | Base URL | Model | Type |
|------|----------|-------|------|
| Groq | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | openai-compatible |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | openai-compatible |
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-20250514` | anthropic |
| Google Gemini | `https://generativelanguage.googleapis.com` | `gemini-2.0-flash` | google |
| Mistral AI | `https://api.mistral.ai/v1` | `mistral-large-latest` | openai-compatible |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | openai-compatible |
| Ollama | `http://localhost:11434/v1` | `llama3` | openai-compatible |
| OpenCode Serve | `http://localhost:8081/v1` | `default` | openai-compatible |

Built-in providers have `isBuiltIn: true` and cannot be deleted (only disabled).

#### Enable/Disable Toggle

- Toggle switch on each card
- Disabling a provider removes it from routing dropdowns
- If a disabled provider is currently assigned to a feature, show warning
- Cannot disable the last provider assigned to a feature

#### Delete Provider

- Only custom providers can be deleted (built-in cannot)
- Confirm dialog before deletion
- If assigned to any feature, show warning and reassign to None

### 2. Feature Routing

#### Routing Table

| Feature | Description | Primary | Fallback 1 | Fallback 2 |
|---------|-------------|---------|------------|------------|
| Chat | CampusFlow AI chatbot | [Groq ▼] | [OpenAI ▼] | [None ▼] |
| Enrichment | Opportunity data enrichment | [OpenAI ▼] | [DeepSeek ▼] | [None ▼] |
| Tasks | AI task generation | [Groq ▼] | [None ▼] | [None ▼] |
| Timetable | Schedule optimization | [Groq ▼] | [None ▼] | [None ▼] |

Each dropdown lists:
- All enabled providers
- "None" option (no fallback)

#### Routing Logic

When a feature needs AI:
1. Try primary provider
2. If primary fails (timeout, error, rate limit), try fallback 1
3. If fallback 1 fails, try fallback 2
4. If all fail, return error to user

#### Routing Updates

- Save button at bottom of routing table
- Changes take effect immediately (no server restart)
- Toast notification on save

### 3. Visual Graph

#### Layout

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│   PROVIDERS              FEATURES                      │
│                                                        │
│   ┌───────┐             ┌──────────┐                   │
│   │ Groq  │━━━━━━━━━━━▶│   Chat   │                   │
│   └───────┘             └──────────┘                   │
│       ┃                                                 │
│       ┗ ━ ━ ━ ━ ━ ━ ━ ┌──────────┐                    │
│                        │  Tasks   │                    │
│                        └──────────┘                    │
│                                                        │
│   ┌───────┐             ┌──────────┐                   │
│   │OpenAI │━━━━━━━━━━━▶│Enrichment│                   │
│   └───────┘             └──────────┘                   │
│       ┃                                                 │
│       ┗ ━ ━ ━ ━ ━ ━ ━ ┌──────────┐                    │
│                        │   Chat   │ (fallback)         │
│                        └──────────┘                    │
│                                                        │
│   Legend: ━━━ Primary  ━ ━ ━ Fallback                  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

#### Visual Elements

- **Provider nodes** — Rounded rectangles with provider name and status dot (green=enabled, gray=disabled)
- **Feature nodes** — Rounded rectangles with feature name
- **Solid lines (━━━)** — Primary routing
- **Dashed lines (━ ━ ━)** — Fallback routing
- **Line colors** — Each provider has a unique color:
  - Groq: `#F55036` (orange-red)
  - OpenAI: `#10A37F` (green)
  - Anthropic: `#D97757` (brown)
  - Google Gemini: `#4285F4` (blue)
  - Mistral: `#FF7000` (orange)
  - DeepSeek: `#4D6BFE` (blue)
  - Ollama: `#FFFFFF` (white)
  - Custom: `#A855F7` (purple)

#### Interactivity

- **Hover** — Highlight connected lines, show tooltip with details
- **Click provider node** — Scroll to provider card
- **Click feature node** — Scroll to routing row
- **Click line** — Show re-route dropdown

---

## Backend API

### Provider Endpoints

```
GET    /api/ai/providers              — List all providers
POST   /api/ai/providers              — Create provider (encrypts key)
PUT    /api/ai/providers/:id          — Update provider
DELETE /api/ai/providers/:id          — Delete provider (custom only)
PATCH  /api/ai/providers/:id/toggle   — Enable/disable provider
POST   /api/ai/providers/:id/test     — Test connection
```

### Routing Endpoints

```
GET    /api/ai/routing                — Get all feature routing
PUT    /api/ai/routing                — Update routing for a feature
```

### Response Formats

#### GET /api/ai/providers

```json
{
  "providers": [
    {
      "id": "clx1234...",
      "name": "Groq",
      "baseUrl": "https://api.groq.com/openai/v1",
      "apiKey": "gsk_...3x7k",
      "model": "llama-3.3-70b-versatile",
      "type": "openai-compatible",
      "enabled": true,
      "isBuiltIn": true
    }
  ]
}
```

Note: `apiKey` is masked — only last 4 chars visible.

#### POST /api/ai/providers/:id/test

```json
{
  "success": true,
  "latency": 234,
  "model": "llama-3.3-70b-versatile",
  "response": "Hello! I'm working correctly."
}
```

Or on failure:

```json
{
  "success": false,
  "error": "Invalid API key",
  "latency": 1200
}
```

---

## Security

### API Key Encryption

- Keys encrypted with AES-256-GCM before storing in DB
- Encryption key stored in `AI_ENCRYPTION_KEY` env var (32 chars min)
- Each key gets a unique IV (initialization vector)
- Auth tag stored alongside ciphertext

### API Response Masking

- Never return full API key in responses
- Show only last 4 characters: `sk-...3x7k`
- Full key only decrypted internally when making AI calls

### Access Control

- All `/api/ai/*` routes protected by `authorize(['SUPER_ADMIN'])`
- Frontend hides AI Manager link for non-super-admins
- Route guard on `/admin/ai-manager`

### Logging

- All AI calls log provider name and model (not the key)
- Errors log sanitized messages (no key exposure)

---

## Frontend Components

### New Files

```
apps/web/src/
├── pages/AiManagerPage.tsx          # Main page
├── components/ai/
│   ├── ProviderCard.tsx             # Provider card component
│   ├── ProviderModal.tsx            # Add/edit provider modal
│   ├── RoutingTable.tsx             # Feature routing table
│   ├── AiGraph.tsx                  # SVG visual graph
│   └── TestConnectionButton.tsx     # Test connection button
```

### Modified Files

```
apps/web/src/
├── App.tsx                          # Add /admin/ai-manager route
├── components/layout/Layout.tsx     # Add AI Manager to sidebar
```

### Backend Files

```
packages/backend/src/
├── routes/ai-manager.ts            # New routes
├── services/ai-manager.ts          # Business logic
├── utils/encryption.ts             # AES-256 encryption utils
├── index.ts                        # Register new routes
```

### Database

```
packages/backend/prisma/
├── schema.prisma                   # Add AiProvider, AiRouting models
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid API key | Show error toast, provider stays disabled |
| Provider timeout (10s) | Try next fallback in chain |
| All providers fail | Show "AI unavailable" message |
| Rate limited | Automatic fallback to next provider |
| No providers configured | Show setup wizard prompt |
| Encryption key missing | Server fails to start with clear error |

---

## Migration Plan

1. Add Prisma models
2. Run `prisma db push`
3. Seed built-in providers
4. Create routes and services
5. Build frontend components
6. Add route and sidebar entry
7. Test each provider connection
8. Test routing and fallback chains

---

## Future Enhancements

- Usage tracking per provider (tokens used, cost estimate)
- Rate limit configuration per provider
- Model-specific routing (e.g., use GPT-4 for complex tasks, GPT-3.5 for simple ones)
- Provider health monitoring dashboard
- API key rotation reminders

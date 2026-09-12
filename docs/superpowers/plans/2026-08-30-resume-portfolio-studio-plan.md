# CampusFlow — Resume Studio + Portfolio Studio Plan

**Date:** 2026-08-30
**Status:** DRAFT — needs approval before coding
**Author:** Dev Lead / PM
**Workspace:** `D:/Alpha Coders/CampusFlow`
**For workers:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` task-by-task. Checkbox syntax for tracking.

**Goal (one sentence):** Let every CampusFlow user build a job-ready resume (data → PDF) and instantly turn it into a live portfolio website (resumeData → theme → publish).

---

## 1. Overview

We add two new studios. Both do not exist today. Both live under a new sidebar group **CAREER**.

| Studio | What user does | What user gets |
|--------|---------------|----------------|
| **Resume Studio** | Fill personal info, skills, projects, experience, education. Preview live. Export. | A clean PDF resume (A4, one page, printable). Data saved for reuse. |
| **Portfolio Studio** | Click "Import from Resume" (or fill manually). Pick a theme from 30. Preview. Publish. | A public portfolio website link (via Porty). Link saved in CampusFlow. |

Resume is the source of truth. Portfolio reuses the same `resumeData` so user does not type twice.

Current state checked: `apps/web/src/components/layout/Layout.tsx` has no CAREER section. `apps/web/src/App.tsx` has no `/resume-studio` or `/portfolio-studio` routes. No resume/portfolio code anywhere (grep found 0 project files). So we build from scratch.

**Porty integration note:** Porty lives at `https://porty-eight.vercel.app`. It already supports `?import=<base64 json>` to pre-fill data. After user publishes inside the iframe, Porty sends `postMessage({ type: 'porty:published', slug })` back. We listen and save slug.

---

## 2. Goals / Non-Goals

### Goals
- Student can create, edit, preview, and download a resume as PDF in under 5 minutes.
- Student can create a portfolio website in under 2 minutes using the same resume data.
- Resume data is saved locally and later on server (no data loss on refresh).
- PDF looks good on print and on screen.
- Portfolio gives a shareable public URL that student can copy.
- Works for all roles (STUDENT, TEACHER, etc.) but primary user is STUDENT.
- Dark mode and mobile work.

### Non-Goals (we will NOT do now)
- No AI resume writing or AI suggestions (later).
- No ATS score or resume analysis.
- No custom domain for portfolio (Porty gives `porty-eight.vercel.app/<slug>`).
- No team / collaboration edit.
- No server-side PDF rendering (client-side only for v1).
- No resume templates picker beyond 1 clean default (v1 has one good layout; more later).
- No backend storage for resume in v1 DB migration (use localStorage first, API later — keeps plan simple).

---

## 3. Data Model

Keep it simple. One TypeScript type reused everywhere.

### 3.1 Resume

```ts
// apps/web/src/types/resume.ts
type ResumePersonalInfo = {
  fullName: string
  email: string
  phone: string
  location: string
  headline: string        // e.g. "B.Tech CSE Student | Frontend Developer"
  summary: string         // 2-3 lines
  links: { label: string; url: string }[] // LinkedIn, GitHub, Portfolio, etc.
}

type ResumeSkill = { name: string; category?: string } // or plain string[]

type ResumeProject = {
  id: string
  title: string
  description: string
  tech: string[]          // ["React", "Node.js"]
  link?: string
  date?: string           // "Jan 2026"
}

type ResumeExperience = {
  id: string
  role: string
  company: string
  location?: string
  startDate: string       // "2025-06"
  endDate: string         // "2025-08" or "Present"
  bullets: string[]       // 2-3 points
}

type ResumeEducation = {
  id: string
  degree: string          // "B.Tech Computer Science"
  school: string          // "ABC College"
  location?: string
  startDate: string
  endDate: string
  cgpa?: string           // "8.5"
}

type ResumeData = {
  personalInfo: ResumePersonalInfo
  skills: string[]        // simple for v1: ["React", "Python", "SQL"]
  projects: ResumeProject[]
  experience: ResumeExperience[]
  education: ResumeEducation[]
  updatedAt: string       // ISO date
}

// Stored as:
type StoredResume = {
  id: string              // userId or "default"
  data: ResumeData
}
```

LocalStorage key: `campusflow:resume:${userId}` → JSON string of `ResumeData`.

Later API (not in v1, but shape ready):
- `GET /api/resume` → ResumeData | null
- `PUT /api/resume` → save ResumeData

### 3.2 Portfolio

```ts
type PortfolioData = {
  id: string
  userId: string
  resumeId: string | null   // links to resume, null if manual
  themeId: string           // "theme-01" ... "theme-30"
  slug: string | null       // filled after publish, e.g. "rohit-verma-123"
  publicUrl: string | null  // "https://porty-eight.vercel.app/rohit-verma-123"
  importedAt: string        // when we imported from resume
  publishedAt: string | null
  data: ResumeData          // snapshot of data sent to Porty (so portfolio frozen at publish time)
}

type PortyImportPayload = ResumeData & {
  theme?: string            // Porty can read theme if we pass it
}
```

LocalStorage key: `campusflow:portfolio:${userId}` → JSON string of `PortfolioData`.

Porty expects base64 of JSON in URL:
```
https://porty-eight.vercel.app?import=<btoa(JSON.stringify(portyPayload))>
```
Porty after publish:
```js
window.parent.postMessage({ type: 'porty:published', slug: 'my-portfolio-123' }, '*')
```
We listen, verify origin is `https://porty-eight.vercel.app` (or allow `*` for dev), save slug.

---

## 4. UX Flows

### 4.1 Resume Studio — Fill → Preview → Export PDF

```
Sidebar: CAREER > Resume Studio (/resume-studio)
Page layout: Two columns on desktop, stacked on mobile.

Left (60%): Form sections (accordion or tabs)
  1. Personal Info (name, email, phone, location, headline, summary, links)
  2. Skills (chips input, add/delete)
  3. Projects (add card, title + desc + tech + link + date)
  4. Experience (add card, role + company + dates + bullets)
  5. Education (add card, degree + school + dates + cgpa)

Right (40%): Live Preview (sticky)
  - Paper look, A4 ratio, white card
  - Shows exactly what PDF will look like
  - Updates on every keystroke

Top bar actions:
  [Save] (auto-save + toast), [Export PDF], [Copy Data], [Clear]

Export PDF:
  click Export PDF → show spinner → generate via jspdf/html2canvas OR react-pdf → download file `Rohit_Verma_Resume.pdf`
  also offer "Print" (window.print with @media print styles)

Empty state:
  "No resume yet. Start with Personal Info or Import from Coding Profile."

Auto-save:
  debounce 800ms → save to localStorage → toast "Saved" (quiet)
```

Validation (simple, not blocking):
- fullName required, email must look like email
- At least one skill or one project to allow PDF export (warn, not block)
- No hard errors on every field — allow save anytime.

### 4.2 Portfolio Studio — Import resumeData → Pick theme → Publish iframe

```
Sidebar: CAREER > Portfolio Studio (/portfolio-studio)

Top: Banner — "Build your portfolio from your resume in 30 seconds"
If no resume exists: show card "Create your resume first" with button → /resume-studio

If resume exists:
  Step 1 - Source card:
    Shows resume summary: "Rohit Verma — 3 projects, 5 skills — Updated 2 hours ago"
    Button: [Import from Resume] (primary)
    Also: [Edit Resume] link to /resume-studio
    On click Import: copy resumeData to portfolio draft state, toast "Imported!"

  Step 2 - Theme picker:
    Grid of 30 theme cards (thumbnail + name + "Use")
    Search not needed — 30 is small. Show 6 per row on desktop, 2 on mobile.
    Selected theme has ring border + check.
    Data: const themes = Array.from({length:30}, (_,i)=> ({id:`theme-${i+1}`, name:`Theme ${i+1}`, thumb:`/porty-thumbs/${i+1}.png`} ))
    For v1 thumbs can be placeholder colored cards with theme name (no need to fetch real images yet).

  Step 3 - Preview & Publish:
    Button: [Preview Portfolio] → opens iframe below
    Button: [Publish Portfolio] (disabled until theme picked + data imported)

Iframe area:
  - Hidden until preview/publish clicked
  - <iframe src="https://porty-eight.vercel.app?import=<base64>" className="w-full h-[700px] rounded-xl border" />
  - Loading spinner while iframe loads
  - Error if base64 too long (>2000 chars URL may break) → fallback: use postMessage to send data after iframe load (ask Porty team). For v1, keep payload small (trim summary to 200 chars if needed).

After publish:
  Porty sends postMessage with slug.
  We show success card: "Your portfolio is live! https://porty-eight.vercel.app/<slug> [Copy] [Open]"
  Save to localStorage: portfolio.slug, publicUrl, publishedAt

Bottom: List of previous portfolios (if any) with date + slug + link
```

### 4.3 Cross-linking

- Resume Studio page has a footer button: "Create Portfolio from this Resume →" → navigates to `/portfolio-studio?import=1` (auto-imports on load).
- Portfolio Studio header has "Edit Resume" → `/resume-studio`.

---

## 5. Tech Decisions

### 5.1 Storage

| Phase | Where | Why |
|-------|-------|-----|
| **v1 (this plan)** | `localStorage` | Fast, no backend work, no migration, no auth changes. Data per browser but ok for CampusFlow demo. |
| **v2 (later)** | Add `Prisma Resume` + `Portfolio` models + `/api/resume` + `/api/portfolio` endpoints | Sync across devices, college admin can see. Schema ready but don't build now (YAGNI). |

LocalStorage helpers live in `apps/web/src/lib/resumeStorage.ts`:
```ts
export function saveResume(userId: string, data: ResumeData): void
export function loadResume(userId: string): ResumeData | null
export function savePortfolio(userId: string, data: PortfolioData): void
export function loadPortfolio(userId: string): PortfolioData | null
```

### 5.2 PDF Export

Options compared:

| Library | Pros | Cons | Pick? |
|---------|------|------|-------|
| `jspdf` + `html2canvas` | Captures the preview DOM exactly, easy | Output is an image PDF, text not selectable, larger file, needs canvas | **Yes for v1** — fastest, looks exactly like preview |
| `react-pdf` / `@react-pdf/renderer` | Text selectable, small file, pro | Need to rebuild layout in PDF components, double work | v2 option |
| `window.print` | Native, no dep | Not a download, depends on browser | As secondary "Print" button |

**Decision for v1:** Use `jspdf` + `html2canvas` (install `jspdf` + `html2canvas`). Render hidden preview div at A4 size (794x1123 px at 96dpi), call `html2canvas(previewRef, {scale:2})` → `canvas.toDataURL` → `jsPDF.addImage` → `save`. Keep one default resume layout so preview == PDF.

Future: swap to `react-pdf` without changing data model.

Install:
```bash
npm add jspdf html2canvas
```

### 5.3 Porty Iframe

- **Base URL:** `https://porty-eight.vercel.app`
- **Import:** `?import=` + `btoa(encodeURIComponent(JSON.stringify(payload)))` — use `encodeURIComponent` to handle unicode safely, then `btoa`. Better: `btoa(unescape(encodeURIComponent(json)))` pattern.
- **URL length risk:** Base64 of full resume can be ~3-5 KB. URL limit is ~2000-8000 chars depending on browser. Tested: 5 KB base64 in URL works in Chrome but close to limit. Mitigate: trim `description` fields to 300 chars for import, or ask Porty to support `postMessage` inbound. For v1, keep payload under 4 KB, add warning if too large, offer manual paste fallback.
- **Publish back:** Listen once in `PortfolioStudioPage`:
```ts
useEffect(() => {
  const handler = (e: MessageEvent) => {
    if (e.origin !== 'https://porty-eight.vercel.app' && e.origin !== 'http://localhost:3000') return
    if (e.data?.type === 'porty:published' && e.data.slug) {
      // save slug
    }
  }
  window.addEventListener('message', handler)
  return () => window.removeEventListener('message', handler)
}, [])
```
- **Security:** Check `event.origin`, do not use `*`. Show slug only after valid origin.
- **Fallback:** If Porty never sends message (old deploy), also poll `localStorage` or give user manual input: "Paste your published URL here" with a text field.

### 5.4 Styling & Dark Mode

- Reuse CampusFlow tokens: `bg-white dark:bg-night-800`, `border-surface-200 dark:border-night-600`, `text-primary-600` etc. (see existing `Layout.tsx` brass/primary).
- Resume preview card is intentionally always white (paper), even in dark mode — real resume prints on white.
- Theme picker cards use same `Card` component style.
- No new global CSS.

### 5.5 Icons & Nav

Add new nav section in `Layout.tsx`:

```ts
{ label: 'CAREER', items: [
  { path: '/resume-studio', label: 'Resume Studio', icon: FileText },
  { path: '/portfolio-studio', label: 'Portfolio Studio', icon: Globe },
]}
```

For each role (`STUDENT`, `TEACHER`, `COLLEGE_ADMIN`, `SUPER_ADMIN`) add CAREER section. Keep after CAMPUS, before Management. FileText already imported; add `Globe` from `lucide-react`.

Badge idea (optional v1): show dot if no resume exists yet (prompt user).

---

## 6. Routes & File Structure

### 6.1 Routes

In `apps/web/src/App.tsx` add inside the protected `<Route path="/">`:

```tsx
import ResumeStudioPage from './pages/ResumeStudioPage'
import PortfolioStudioPage from './pages/PortfolioStudioPage'

// inside <Routes> <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
<Route path="resume-studio" element={<ResumeStudioPage />} />
<Route path="portfolio-studio" element={<PortfolioStudioPage />} />
```

Also add to `CommandPalette.tsx` if it exists (search).

### 6.2 New Files

| File | What it does | Size hint |
|------|--------------|-----------|
| `apps/web/src/types/resume.ts` | `ResumeData`, `ResumePersonalInfo`, `ResumeProject`, etc. types | ~80 lines |
| `apps/web/src/lib/resumeStorage.ts` | `saveResume`, `loadResume`, `savePortfolio`, `loadPortfolio`, helpers for base64, date | ~60 lines |
| `apps/web/src/lib/porty.ts` | `buildPortyImportUrl(data, themeId)`, `parsePortyMessage(e)`, `isValidPortyOrigin(origin)` | ~50 lines |
| `apps/web/src/pages/ResumeStudioPage.tsx` | Main resume page: form + live preview + PDF export | ~350-450 lines (keep under 500, extract sub-components) |
| `apps/web/src/components/resume/ResumePreview.tsx` | Pure preview component (takes `ResumeData`, renders A4 paper look) — reused for PDF capture | ~120 lines |
| `apps/web/src/components/resume/ResumeForm.tsx` | Form sections (or split into `PersonalInfoForm`, `SkillsForm`, etc.) — collects inputs, calls `onChange` | ~250 lines total if split |
| `apps/web/src/pages/PortfolioStudioPage.tsx` | Portfolio page: import card, theme grid, iframe, success card | ~350 lines |
| `apps/web/src/components/portfolio/ThemeGrid.tsx` | 30-theme picker grid | ~80 lines |
| `apps/web/src/components/portfolio/PortyFrame.tsx` | Iframe wrapper with loader, error, postMessage listener | ~90 lines |

No backend files in v1. Total new code ~1200-1500 lines, all frontend.

### 6.3 Modified Files

| File | Change |
|------|--------|
| `apps/web/src/components/layout/Layout.tsx` | Add `import { Globe }` and `CAREER` nav section to each role map; ensure collapsed sidebar still shows icons |
| `apps/web/src/App.tsx` | Add 2 routes + lazy imports |
| `apps/web/package.json` | `jspdf`, `html2canvas` (and `@types/html2canvas` if needed) |
| `apps/web/src/components/CommandPalette.tsx` | (optional) add resume/portfolio to searchable commands |

### 6.4 What we do NOT touch

- `packages/backend/**` — no DB migration, no API route (keeps v1 simple and shippable fast).
- `apps/web/src/lib/api.ts` — no changes needed in v1.
- Any existing pages — zero regression risk.

---

## 7. Components Detail (plain English)

### ResumePreview
- Props: `{ data: ResumeData }`
- Renders a white card: name big + headline + contact row (email · phone · location)
- Links row (small text, blue links)
- Summary paragraph
- Skills as small pill chips
- Projects: each with title (bold) + tech tags + date + description + link
- Experience: role — company, dates, bullets with dot
- Education: degree — school, dates, CGPA
- Uses `ref` forwarded for `html2canvas` to capture.

### ResumeForm
- Props: `{ data: ResumeData, onChange: (next: ResumeData) => void }`
- 5 collapsible sections with Add/Remove.
- Inputs use existing `Input` component where possible, else plain `input` with `className="input-field"` tokens.
- Skills: input + Enter adds chip, X removes.
- Projects/Experience/Education: repeatable card with delete button. Each card has unique `id` via `Date.now()` or `crypto.randomUUID()`.
- On every change, call `onChange` → parent auto-saves.

### ThemeGrid
- Props: `{ themes: Theme[], selectedId: string | null, onSelect: (id) => void }`
- Grid 3/6 cols, gap 3.
- Each theme card: placeholder gradient + theme name + selected ring.

### PortyFrame
- Props: `{ importUrl: string | null, onPublished: (slug: string) => void }`
- Renders nothing if `importUrl` null.
- Else renders `iframe` + `onLoad` spinner + `onError`.
- Attaches `message` listener on mount, cleans on unmount.

---

## 8. Step-by-Step Implementation Plan

Checkboxes for agent workers. Each step keeps file under 500 lines.

### Milestone 1 — Types + Storage + Nav (0.5 day)

- [ ] **1.1 Create types** — `apps/web/src/types/resume.ts` with `ResumeData` etc. Match section 3 exactly. Export all. No `any`.
- [ ] **1.2 Create storage helpers** — `apps/web/src/lib/resumeStorage.ts`. Functions: `getResumeKey(userId)`, `saveResume`, `loadResume`, `clearResume`, same for portfolio. Use `try/catch` for JSON parse. Handle missing `userId` gracefully.
- [ ] **1.3 Create Porty helper** — `apps/web/src/lib/porty.ts`. `buildPortyImportUrl(data, themeId)` returns string. Handle unicode safely. Export `PORTY_BASE = 'https://porty-eight.vercel.app'`. Export `isValidPortyOrigin`. Add `trimPayloadForUrl` helper that shortens long descriptions if json length > 4000.
- [ ] **1.4 Install PDF deps** — `npm add jspdf html2canvas --workspace=@campusflow/web` (or at `apps/web`). Verify `npm run build` still passes (no import yet, just pkg).
- [ ] **1.5 Add nav** — Edit `Layout.tsx`: import `Globe`, add CAREER section to all 4 role maps. Test sidebar collapsed/expanded. No other change.
- [ ] **1.6 Add routes** — Edit `App.tsx`: add 2 stub pages (empty divs with "Coming soon") + routes. Verify navigation works, no 404.
- [ ] **1.7 Commit M1** — `feat(career): add resume/portfolio types, storage, nav and routes`

### Milestone 2 — Resume Studio (1.5 days)

- [ ] **2.1 Build ResumePreview** — `apps/web/src/components/resume/ResumePreview.tsx`. Takes `ResumeData` prop, renders paper card. Forward ref for html2canvas. Keep white card even in dark mode. Test with mock data. Ensure print styles look good (`@media print` hidden Chrome etc., but we keep simple).
- [ ] **2.2 Build ResumeForm sections** — `apps/web/src/components/resume/ResumeForm.tsx` (or split into `PersonalInfoSection`, `SkillsSection`, `ProjectsSection`, `ExperienceSection`, `EducationSection` under `components/resume/sections/`). Inputs controlled. Add/delete works. Skills chips work. Do NOT add comments unless asked.
- [ ] **2.3 Build ResumeStudioPage** — `apps/web/src/pages/ResumeStudioPage.tsx`.
  - Load: on mount, `loadResume(user.id)` if exists else create empty default (see empty template below).
  - State: `const [data, setData] = useState<ResumeData>(emptyResume)`
  - Auto-save: `useEffect(() => { const t = setTimeout(() => saveResume(userId, data), 800); return ()=>clearTimeout(t)}, [data])`
  - Layout: `grid lg:grid-cols-[1.1fr_0.9fr] gap-6` left form, right sticky preview.
  - Top actions: Save (manual, toast), Export PDF, Clear (confirm modal).
  - "Create Portfolio →" link at bottom.
- [ ] **2.4 PDF export logic** — In `ResumeStudioPage`, `handleExport`:
  ```ts
  const el = previewRef.current
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
  const imgData = canvas.toDataURL('image/png')
  const pdf = new jsPDF('p', 'mm', 'a4')
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = (canvas.height * pdfW) / canvas.width
  pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH)
  pdf.save(`${safeName}_Resume.pdf`)
  ```
  Add error toast if fails. Add "Print" secondary button: `window.print()`.
- [ ] **2.5 Empty template** — Provide `emptyResumeData(user)` helper:
  ```ts
  { personalInfo: { fullName: user?.name || '', email: user?.email || '', phone: '', location: '', headline: '', summary: '', links: [{label:'LinkedIn', url:''}] }, skills: [], projects: [], experience: [], education: [] }
  ```
- [ ] **2.6 Test & polish** — Fill all fields, save, refresh (data persists), export PDF and open it, check one-page fit, try in dark mode, try on mobile. Fix overflow.
- [ ] **2.7 Commit M2** — `feat(resume): add Resume Studio with form, live preview and PDF export`

### Milestone 3 — Portfolio Studio (1 day)

- [ ] **3.1 Build ThemeGrid** — `apps/web/src/components/portfolio/ThemeGrid.tsx`. Takes `selectedId`, `onSelect`. 30 placeholder themes (no need to fetch real images). Use simple gradient cards with theme name and number. Selected shows ring.
- [ ] **3.2 Build PortyFrame** — `apps/web/src/components/portfolio/PortyFrame.tsx`. Iframe + loader + message listener. Props `importUrl`, `onPublished`. Listener checks origin, calls `onPublished(slug)`. Also show manual slug input fallback: "If your portfolio published but we didn't catch it, paste URL here".
- [ ] **3.3 Build PortfolioStudioPage** — `apps/web/src/pages/PortfolioStudioPage.tsx`.
  - State: `resumeData` from storage, `selectedTheme`, `importUrl`, `publishedSlug`, `isImported`.
  - On mount: load resume + load portfolio (if previously published, show success card).
  - Import button: copies resumeData to portfolio draft, sets isImported.
  - Theme select: updates `selectedTheme`.
  - Preview button: builds `buildPortyImportUrl({ ...resumeData, theme: selectedTheme })`, sets `importUrl`, scrolls to iframe.
  - On published: `savePortfolio(userId, { slug, publicUrl, publishedAt, ... })`, show success card + confetti/toast.
  - If `?import=1` in URL search params (coming from Resume Studio), auto-import on mount.
  - If no resume: show "Create resume first" card with CTA.
- [ ] **3.4 Connect Resume → Portfolio link** — Add "Create Portfolio from this Resume →" button at bottom of `ResumeStudioPage` → `navigate('/portfolio-studio?import=1')`.
- [ ] **3.5 Test Porty end-to-end** — Import, pick theme, preview (iframe loads), publish inside iframe, verify slug back and saved, copy link works, open link in new tab, refresh portfolio page (still shows published link).
- [ ] **3.6 Commit M3** — `feat(portfolio): add Portfolio Studio with theme picker and Porty iframe publish`

### Milestone 4 — Polish, Tests, Docs (0.5 day)

- [ ] **4.1 Responsive check** — Both pages usable at 360px, 768px, 1024px. Sidebar drawer on mobile. Iframe height adjusts.
- [ ] **4.2 Dark mode check** — Toggle theme, verify both pages light/dark look good. Resume paper stays white.
- [ ] **4.3 Edge cases** — localStorage quota exceeded toast; Porty unreachable → show "Porty is currently unavailable" + manual URL input; PDF export with very long resume (2 pages) → handle multi-page: add logic to split if `pdfH > 297` mm, add new page and slice image (or simply allow 1-page overflow with smaller scale).
- [ ] **4.4 Add quick tests** — `apps/web/src/__tests__/resume.test.ts` simple unit for `buildPortyImportUrl` and storage helpers (no UI test needed for v1).
- [ ] **4.5 Verify build** — `npm run build` passes, `npx tsc --noEmit` passes.
- [ ] **4.6 Commit M4** — `chore(career): polish resume and portfolio studio, add tests and docs`

**Total estimate:** ~3.5 days for one dev. Can be 2 days with two devs (M2 and M3 parallel after M1).

---

## 9. What We Deliver for Demo

For PO sign-off, show:

1. Sidebar has CAREER → Resume Studio, Portfolio Studio.
2. Fill Resume Studio → live preview updates → Save → refresh keeps data → Export PDF downloads a correct file.
3. Go to Portfolio Studio → Import from Resume → pick theme 7 → Preview shows iframe with data pre-filled → Publish inside iframe → get back `https://porty-eight.vercel.app/<slug>` and card appears in CampusFlow.
4. Copy link and open in new tab — real portfolio.

No backend deploy needed for v1.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation | Owner |
|------|--------|------------|-------|
| **PDF looks different from preview** | High — user prints bad resume | Use html2canvas capture of preview so PDF = preview pixel-perfect. Test A4 first. | Frontend dev |
| **URL too long for Porty import** | Medium — iframe blank or 414 error | Trim long texts for import (200-300 chars), keep payload <4KB, add warning. Ask Porty team to support postMessage inbound as v2. | Frontend dev |
| **Porty CORS / postMessage origin mismatch** | Medium — slug never received | Check origin allowlist, log incoming messages, provide manual "paste your URL" fallback so user not blocked. | Frontend dev |
| **localStorage full or blocked (Safari private)** | Low — data lost | Wrap all storage in try/catch, show toast, offer "Download JSON" backup button (Copy Data). | Frontend dev |
| **30 theme thumbs missing** | Low — ugly picker | Use placeholder gradient cards for v1, swap to real thumbs later via Porty API/cdn. | Designer or dev |
| **User never creates resume, goes straight to Portfolio** | Medium — empty portfolio | Portfolio page shows strong empty state with CTA to Resume Studio; Import button disabled until resume exists. | UX |
| **Dark mode makes resume paper dark** | Low — prints wrong | Force preview wrapper to `bg-white` with `color-scheme: light` style, regardless of app theme. | Frontend dev |
| **Long resume overflows one A4 page** | Medium — PDF clipped | For v1, shrink scale if height > A4; for v2, split into 2 pages. Accept one-page limit first (most student resumes are one page). | Frontend dev |
| **No backend = data lost if user switches device** | Low for v1 — demo only | Mention as known limitation in plan; add backend in v2 with Prisma `Resume` model + `/api/resume` (schema already sketched, just add later). | PM |

---

## 11. Decisions Needed (for user approval)

Before we start coding, please confirm:

1. **Confirm localStorage for v1** — OK to not have DB/API yet, or do you want server storage now? (Recommendation: localStorage for speed, ship in 3 days.)
2. **Confirm single resume template for v1** — One clean layout first, or do you need multiple templates picker now?
3. **Confirm Porty base URL** — `https://porty-eight.vercel.app` correct? Does Porty prod allow `?import` and postMessage as described, or do we need to coordinate with Porty team for exact message shape?
4. **Confirm 30 themes are placeholder cards for now** — OK to ship with colored cards labeled Theme 1-30, replace with real thumbnails later?
5. **Confirm PDF via jspdf + html2canvas** — Accept image-based PDF (text not selectable) for v1? Or require text-selectable PDF now (needs react-pdf, more time)?
6. **Confirm nav label** — `CAREER` section name OK, or prefer `TOOLS` / `STUDIO` / `GROWTH`?
7. **Confirm who can see STUDIO** — All roles, or only STUDENT? (Plan says all roles, STUDENT primary.)

If yes to all, we start Milestone 1 next.

---

## 12. Out of Scope for This Plan (explicit)

- No `packages/backend/prisma/schema.prisma` change.
- No `packages/backend/src/routes/*` new routes.
- No `packages/backend/src/index.ts` mount.
- No auth or college scoping for resume (localStorage is per-user-browser).
- No AI, no ATS, no analytics.

---

## 13. Appendix — Empty Resume Example (what preview shows for new user)

```json
{
  "personalInfo": {
    "fullName": "Aarav Sharma",
    "email": "aarav@campus.edu",
    "phone": "+91 98765 43210",
    "location": "Delhi, India",
    "headline": "B.Tech CSE Student | Frontend Developer",
    "summary": "Frontend developer with 2 years of experience building fast, accessible web apps. Passionate about UI/UX and open source.",
    "links": [
      { "label": "LinkedIn", "url": "https://linkedin.com/in/aarav" },
      { "label": "GitHub", "url": "https://github.com/aarav" },
      { "label": "Portfolio", "url": "https://porty-eight.vercel.app/aarav" }
    ]
  },
  "skills": ["React", "TypeScript", "Node.js", "Tailwind CSS", "Python", "Git", "Figma"],
  "projects": [
    {
      "id": "p1",
      "title": "CampusFlow — Campus OS",
      "description": "Built placement and room management modules. Improved load time by 40%.",
      "tech": ["React", "Prisma", "PostgreSQL"],
      "link": "https://github.com/aarav/campusflow",
      "date": "May 2026"
    }
  ],
  "experience": [
    {
      "id": "e1",
      "role": "Frontend Intern",
      "company": "TechCorp",
      "location": "Remote",
      "startDate": "2025-06",
      "endDate": "2025-08",
      "bullets": ["Shipped 10+ UI components used by 5k users", "Reduced bundle size by 18%"]
    }
  ],
  "education": [
    {
      "id": "ed1",
      "degree": "B.Tech Computer Science",
      "school": "ABC Institute of Technology",
      "location": "Delhi",
      "startDate": "2022-08",
      "endDate": "2026-05",
      "cgpa": "8.7"
    }
  ],
  "updatedAt": "2026-08-30T00:00:00.000Z"
}
```

---

## 14. Appendix — Porty Import Payload Example (base64)

```js
// before encoding
const payload = {
  personalInfo: resume.personalInfo,
  skills: resume.skills,
  projects: resume.projects,
  experience: resume.experience,
  education: resume.education,
  theme: 'theme-07'
}
const json = JSON.stringify(payload)
const b64 = btoa(unescape(encodeURIComponent(json)))
const url = `https://porty-eight.vercel.app?import=${b64}`
```

Porty should decode with `decodeURIComponent(escape(atob(importParam)))` and pre-fill.

---

## 15. Next Step

> ⏳ **Waiting for your approval.** Reply with "Approved" or list changes, and we start Milestone 1 → build Resume Studio + Portfolio Studio.

*No code has been written yet — this is plan only, as requested.*


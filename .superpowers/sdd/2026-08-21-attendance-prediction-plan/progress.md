# SDD ledger — plan: D:\Alpha Coders\CampusFlow\docs\superpowers\plans\2026-08-21-attendance-prediction-plan.md

## Task 1: complete (commits 3c0c5b7..fde23a9, review clean — 1 fix round: indentation + trailing newline; migration bloat noted as dev DB sync issue)

## Global Constraints
- All AI calls MUST go through `chatWithAI()` from `packages/backend/src/ai/client.ts`
- No direct `groq.ts`/`openai.ts` imports outside `ai/client.ts`
- `InternshipStaging.deadline` is `String` type — use string comparison `"2026-08-19"` format
- `HackathonStaging.deadline` is `DateTime` type — use `new Date()` comparison
- Backend at `packages/backend/` (NOT `apps/backend/`)
- Tech: Prisma + SQLite, bcryptjs, jsonwebtoken, uuid
- Frontend: React 18 + Vite, Tailwind CSS, Lucide, Framer Motion, Zustand, React Router v6
- Exact light/dark mode hex colors from design spec
- No Docker — Vercel (frontend) + Render (backend)

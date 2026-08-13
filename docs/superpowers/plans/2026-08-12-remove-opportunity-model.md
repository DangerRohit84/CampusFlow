# Remove Opportunity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Opportunity model and all related code from the backend, as the model no longer exists in the schema but code still references it.

**Architecture:** The Opportunity model has already been removed from the Prisma schema, but the `opportunityAgent.ts` service still contains code that references `prisma.opportunity`. We need to clean up this dead code and remove the unused functions.

**Tech Stack:** TypeScript, Prisma, Express.js

## Global Constraints

- Backend location: `D:\Alpha Coders\CampusFlow\packages\backend`
- Schema location: `packages/backend/prisma/schema.prisma`
- Services location: `packages/backend/src/services/`
- Routes location: `packages/backend/src/routes/`

---

## Analysis

**Current State:**
- The `Opportunity` model does NOT exist in `schema.prisma` (already removed)
- The `opportunities.ts` route file does NOT exist (already deleted)
- The `opportunityAgent.ts` file still contains functions that reference `prisma.opportunity` (dead code)
- The `hackathons.ts` and `internships.ts` routes import `fetchFromAllSources` from `opportunityAgent.ts`

**What Needs to Change:**
1. Remove `fetchAndStoreOpportunities` function from `opportunityAgent.ts` (references `prisma.opportunity`)
2. Remove `enrichOpportunityWithAI` function from `opportunityAgent.ts` (references `prisma.opportunity`)
3. Keep `fetchFromAllSources`, `enrichHackathonStaging`, `enrichInternshipStaging` (still used)
4. No changes needed in `index.ts` (no opportunity route references found)
5. No changes needed in `schema.prisma` (Opportunity model already removed)

---

### Task 1: Clean up opportunityAgent.ts - Remove Dead Code

**Files:**
- Modify: `packages/backend/src/services/opportunityAgent.ts`

**Interfaces:**
- Consumes: None (this is the source)
- Produces: Cleaned service file with only used functions

**What to Remove:**
1. Lines 643-821: The `enrichOpportunityWithAI` function (uses `prisma.opportunity`)
2. Lines 1066-1142: The `fetchAndStoreOpportunities` function (uses `prisma.opportunity`)
3. Lines 673, 793, 1086, 1095, 1103: All `prisma.opportunity.*` calls

**What to Keep:**
- `NormalizedOpportunity` interface (lines 17-39)
- All fetch functions: `fetchDevfolio`, `fetchDevpost`, `fetchInternshala`, `fetchMLH`, `fetchUnstop`
- `fetchFromAllSources` function (lines 1055-1064)
- `enrichHackathonStaging` function (lines 823-934)
- `enrichInternshipStaging` function (lines 936-1045)
- Helper functions: `isEnded`, `stripHtml`, `normalizeMode`, etc.

- [ ] **Step 1: Read the current file to confirm line numbers**

```bash
wc -l "D:\Alpha Coders\CampusFlow\packages\backend\src\services\opportunityAgent.ts"
```

- [ ] **Step 2: Remove `enrichOpportunityWithAI` function**

Delete lines 643-821 (the entire `enrichOpportunityWithAI` function).

- [ ] **Step 3: Remove `fetchAndStoreOpportunities` function**

Delete lines 1066-1142 (the entire `fetchAndStoreOpportunities` function).

- [ ] **Step 4: Verify no remaining `prisma.opportunity` references**

```bash
grep -n "prisma.opportunity" "D:\Alpha Coders\CampusFlow\packages\backend\src\services\opportunityAgent.ts"
```

Expected: No matches found

- [ ] **Step 5: Verify the kept functions still exist**

```bash
grep -n "export async function fetchFromAllSources" "D:\Alpha Coders\CampusFlow\packages\backend\src\services\opportunityAgent.ts"
grep -n "export async function enrichHackathonStaging" "D:\Alpha Coders\CampusFlow\packages\backend\src\services\opportunityAgent.ts"
grep -n "export async function enrichInternshipStaging" "D:\Alpha Coders\CampusFlow\packages\backend\src\services\opportunityAgent.ts"
```

Expected: All three functions found

- [ ] **Step 6: Commit changes**

```bash
cd "D:\Alpha Coders\CampusFlow"
git add packages/backend/src/services/opportunityAgent.ts
git commit -m "refactor: remove dead Opportunity model code from opportunityAgent.ts"
```

---

### Task 2: Verify No Other References to Opportunity

**Files:**
- Read: `packages/backend/src/index.ts`
- Read: `packages/backend/src/routes/hackathons.ts`
- Read: `packages/backend/src/routes/internships.ts`

**Interfaces:**
- Consumes: Cleaned `opportunityAgent.ts`
- Produces: Confirmation that no other cleanup is needed

- [ ] **Step 1: Search for any remaining Opportunity references**

```bash
grep -rn "opportunity" "D:\Alpha Coders\CampusFlow\packages\backend\src" --include="*.ts" | grep -v "node_modules"
```

Expected: Only references in `opportunityAgent.ts` to `NormalizedOpportunity` interface and fetch function internal variables (not `prisma.opportunity`)

- [ ] **Step 2: Verify index.ts has no opportunity routes**

```bash
grep -n "opportunity" "D:\Alpha Coders\CampusFlow\packages\backend\src\index.ts"
```

Expected: No matches

- [ ] **Step 3: Verify hackathons.ts imports are still valid**

```bash
grep -n "import.*opportunityAgent" "D:\Alpha Coders\CampusFlow\packages\backend\src\routes\hackathons.ts"
```

Expected: Import of `fetchFromAllSources` and `enrichHackathonStaging` (both still exist)

- [ ] **Step 4: Verify internships.ts imports are still valid**

```bash
grep -n "import.*opportunityAgent" "D:\Alpha Coders\CampusFlow\packages\backend\src\routes\internships.ts"
```

Expected: Import of `fetchFromAllSources` and `enrichInternshipStaging` (both still exist)

---

### Task 3: Push Schema (Verification Only)

**Files:**
- None (schema already correct)

**Interfaces:**
- Consumes: Verified codebase
- Produces: Confirmation that schema is in sync

- [ ] **Step 1: Run prisma db push to verify schema is in sync**

```bash
cd "D:\Alpha Coders\CampusFlow\packages\backend"; npx prisma db push --skip-generate
```

Expected: Schema is already in sync (Opportunity model was already removed)

- [ ] **Step 2: Report completion**

Summarize all changes made and confirm the Opportunity model and related code have been fully removed.

---

## Summary

| Task | File | Action | Status |
|------|------|--------|--------|
| 1 | `opportunityAgent.ts` | Remove `enrichOpportunityWithAI` and `fetchAndStoreOpportunities` | Pending |
| 2 | Multiple files | Verify no remaining Opportunity references | Pending |
| 3 | `schema.prisma` | Verify schema is in sync | Pending |

**Total Lines to Remove:** ~200 lines of dead code
**Functions to Keep:** `fetchFromAllSources`, `enrichHackathonStaging`, `enrichInternshipStaging`

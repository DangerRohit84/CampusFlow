# Attendance Prediction System — Critical Fix Report

**Date:** 2026-08-21
**Commit:** `6b1cb82`
**Files changed:** 4 (PredictionsTab.tsx, UploadTab.tsx, ScenarioTable.tsx, ManualTab.tsx)

---

## Issues Fixed

### 1. PredictionsTab uses mock data (CRITICAL) ✅
**File:** `apps/web/src/components/attendance/PredictionsTab.tsx`

**Before:** Lines 38-44 generated random data (`total: 35 + Math.floor(Math.random() * 10)`) instead of fetching real records.

**After:** Fetches real data via `attendanceAPI.getHistory()`, aggregates all records by subject to compute real `total` and `present` counts, then passes these to the predict API. Shows a "No attendance records found" message when no history exists.

---

### 2. UploadTab saves with wrong source value (CRITICAL) ✅
**File:** `apps/web/src/components/attendance/UploadTab.tsx`

**Before:** Line 85 called `attendanceAPI.save(records, 'ocr-upload')` but `AttendanceSource` Prisma enum expects `'UPLOAD'`.

**After:** Changed to `attendanceAPI.save(savePayload, 'UPLOAD')`. Also maps the records to the correct save format (subject, date, status).

---

### 3. UploadTab response field name mismatch (CRITICAL) ✅
**File:** `apps/web/src/components/attendance/UploadTab.tsx`

**Before:** Line 56 checked `parsed?.records?.length` but backend returns `{ subjects: [...] }`. Interface used `totalClasses`, `attendedClasses`, `percentage` but AI returns `total`, `present`, `absent`.

**After:** 
- Interface updated to: `subject`, `total`, `present`, `absent`, `percentage`
- Response mapping: `parsed.subjects` → mapped to local format with computed percentage
- Table columns updated: "Attended" → "Present", added "Absent" column
- Backend save call constructs proper payload with subject, date, status

---

### 4. ScenarioTable hardcoded values (IMPORTANT) ✅
**File:** `apps/web/src/components/attendance/ScenarioTable.tsx`

**Before:** Lines 24-28 used hardcoded `classesMissed = 3`, `futureClasses = 6 * 3`, `35`.

**After:** 
- Accepts `subjects?: SubjectFreq[]` prop (classesPerWeek per subject)
- Derives `classesMissed` from subject's `classesPerWeek`
- Uses prediction's `p.total` instead of hardcoded `35`
- PredictionsTab passes `subjects` to ScenarioTable

---

### 5. PredictionsTab "Attended" stat is wrong (IMPORTANT) ✅
**File:** `apps/web/src/components/attendance/PredictionsTab.tsx`

**Before:** Line 116 used `Math.round(p.currentPercentage * 0.35)` — meaningless formula.

**After:** Shows actual `{p.present}/{p.total}` from enriched prediction data (total/present stored in `subjectData` state and merged into predictions from backend response).

---

### 6. ManualTab prevents deleting last row (MINOR) ✅
**File:** `apps/web/src/components/attendance/ManualTab.tsx`

**Before:** Line 48 had `if (rows.length === 1) return` + button was `disabled` when only 1 row.

**After:** Removed the guard. Removed `disabled` prop and `disabled:opacity-30 disabled:cursor-not-allowed` classes from delete button.

---

## TypeScript Compilation
All 4 files compile without errors (`npx tsc --noEmit` — clean).

## Verification
- All `dark:` Tailwind classes preserved for dark mode support
- Backend `AttendanceSource` enum values (`UPLOAD`, `MANUAL`) match frontend usage
- AI response parsing matches backend `/api/attendance/parse` response structure
- History aggregation correctly handles `PRESENT` and `EXCUSED` statuses
- ScenarioTable miss1Week calculation uses real per-subject data

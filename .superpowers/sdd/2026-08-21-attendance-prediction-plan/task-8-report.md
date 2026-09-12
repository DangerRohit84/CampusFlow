# Task 8 Report: Frontend — FrequencyEditor + PredictionsTab

**Status:** DONE

## Files Created

1. **`apps/web/src/components/attendance/FrequencyEditor.tsx`**
   - SubjectFreq interface with name, classesPerWeek, hasLab, hasMakeup
   - +/- buttons to adjust classes per week (range: 1-10)
   - Dark mode support with surface color tokens
   - Renders each subject as a row with name, controls, and "classes/wk" label

2. **`apps/web/src/components/attendance/PredictionsTab.tsx`**
   - Calls `attendanceAPI.predict()` on mount and when subjects/target change
   - Overall risk banner (SAFE/WARNING/AT_RISK) with icon and message
   - Subject-wise cards with: risk badge, percentage, progress bar, stats grid
   - Stats grid shows: Attended count, Safe to Skip / Must Attend, If miss 1/wk, If miss 2/wk
   - FrequencyEditor embedded for adjusting weekly class frequency
   - ScenarioTable imported from `./ScenarioTable` (placeholder stub)

3. **`apps/web/src/components/attendance/ScenarioTable.tsx`** (stub for Task 9)
   - Minimal placeholder so TypeScript compiles
   - Task 9 will replace with full scenario simulator table

## TypeScript Compilation

`npx tsc --noEmit --skipLibCheck` — **0 errors** (clean)

## Design Decisions

- Colors follow spec: Primary `#007060`, Danger `#F07068`, Warning `#F5A623`
- Dark mode: `dark:bg-[#111920]`, `dark:text-[#F4F7F8]`, `dark:border-[#202C35]`
- Mock data in PredictionsTab uses random values for demo; real data will come from backend
- FrequencyEditor manages classesPerWeek only; hasLab/hasMakeup passed through but not yet visualized

## Commit

`06e6b33` — feat: add FrequencyEditor and PredictionsTab components

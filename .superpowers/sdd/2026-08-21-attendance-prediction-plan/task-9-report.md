# Task 9 Report: Frontend — ScenarioTable + HistoryTab

**Status:** DONE

## Files Created/Modified
- `apps/web/src/components/attendance/ScenarioTable.tsx` — Replaced stub with full "What-If Scenario Simulator" table
- `apps/web/src/components/attendance/HistoryTab.tsx` — New component for past uploads history list

## Implementation Details

### ScenarioTable
- Receives `predictions` array and `target` number as props
- Renders 4 scenarios: Attend ALL remaining, Miss 1 class/week, Miss 2 classes/week, Miss 1 full week
- Shows per-subject and overall average percentages
- Color-codes values: green (`text-primary-600`) if >= target, red (`text-danger-600`) if below
- Table header shows subject names dynamically from predictions array
- "Attend ALL" row has primary highlight, "Miss 1 full week" has danger highlight
- Dark mode fully supported with `dark:` Tailwind classes

### HistoryTab
- Fetches history from `attendanceAPI.getHistory()` on mount
- Displays list of past uploads with type icon (Upload for screenshots, Edit3 for manual entries)
- Shows formatted date, subject count, and overall attendance percentage
- Type icon has color-coded background (primary for uploads, warning for manual)
- Handles loading and empty states
- Dark mode fully supported

### Bug Fix
- Fixed a bug in the plan's ScenarioTable code where `getValue(p, p.name)` was called instead of `getValue(p, s.key)` in the table body — the original code would have returned `undefined` for every cell since prediction objects don't have properties named after their subject names.

## TypeScript
- `npx tsc --noEmit` passes with no errors

## Commit
- `ab555e6` — feat: add ScenarioTable and HistoryTab components

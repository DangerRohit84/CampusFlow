# Task 7: Frontend — ManualTab Component

## Status: DONE

## What was built

Created `apps/web/src/components/attendance/ManualTab.tsx` — a fully editable attendance table component with:

- **Editable table** with Date (date picker), Subject (text input), and Status (select dropdown) columns
- **Add Row** button — appends a new row with today's date and PRESENT status
- **Remove Row** button — deletes a row (disabled when only one row remains)
- **All Present Today** button — bulk-fills all today's rows with PRESENT status
- **Save Records** button — calls `attendanceAPI.save(records, 'MANUAL')`, resets table on success
- **Error/success feedback** — inline alerts matching existing UploadTab pattern
- **Dark mode** — full `dark:` class support using project color tokens
- **Reuses existing UI** — `Card`, `Button` components from `components/ui/`

## Implementation details

- Follows existing UploadTab patterns (Card, Button, error/success alerts, dark mode styling)
- Uses `status: 'PRESENT'` as default for new rows
- Filters out empty rows (no subject) before saving
- Table row action buttons use danger hover states
- Status select uses colored pill badges (PRESENT=primary, ABSENT=danger, LATE=warning, EXCUSED=primary)

## Testing

- TypeScript compiles with zero errors (`npx tsc --noEmit` passes cleanly)
- Visual structure matches UploadTab table pattern

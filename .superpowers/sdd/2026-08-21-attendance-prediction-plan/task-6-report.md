# Task 6: Frontend — UploadTab Component

## Status: DONE

## What Was Done
- Installed `tesseract.js` in `apps/web`
- Created `apps/web/src/components/attendance/UploadTab.tsx` with full implementation:
  - Drag-and-drop or click-to-upload image support
  - Dynamic import of Tesseract.js for OCR text extraction
  - Image preview with extracted text viewer
  - Calls `attendanceAPI.parse(text)` to get structured attendance data
  - Displays parsed records in a table with subject, total classes, attended, percentage, and status badges
  - Save button calls `attendanceAPI.save(records, 'ocr-upload')`
  - Full dark mode support using project's `dark:` classes and surface colors
  - Error and success state handling
  - Clear/reset functionality

## Files
- **Created:** `apps/web/src/components/attendance/UploadTab.tsx`
- **Modified:** `apps/web/package.json` (added tesseract.js dependency)

## TypeScript
- Compilation passes cleanly with no errors

## Commit
- `1bd99a0` — feat: add UploadTab with Tesseract.js OCR and AI parsing

## Notes
- Component follows existing project patterns (Card, Button, Badge, clsx, framer-motion conventions)
- No comments added per instructions
- Dynamic import used for Tesseract.js as specified

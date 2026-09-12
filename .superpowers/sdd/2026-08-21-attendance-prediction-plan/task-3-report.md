# Task 3 Report: Backend — Predict Endpoint (Formulas)

## Status: DONE

## What Was Done

Added `POST /predict` route to `packages/backend/src/routes/attendance.ts` with:

- Input validation for subjects array
- Pure math formulas (no AI dependency):
  - Current percentage calculation
  - Safe-to-skip bunks calculation
  - Future class projections (miss 1/week, miss 2/week, attend all)
  - Risk level assessment (SAFE, WARNING, AT_RISK)
  - Recovery classes needed when below target
- Overall summary aggregation
- `authenticate` middleware applied
- Existing `/parse` route untouched

## Commits

- `13e8747` - feat: add attendance predict endpoint with formulas

## Verification

- TypeScript compiles without errors (`npx tsc --noEmit` passed)
- Existing `/parse` route preserved and functional
- Predict route uses pure math (no AI client calls)

## Notes

- The route accepts subjects array with `name`, `total`, `present`, `classesPerWeek`, `weeksRemaining`
- Default target percentage is 75%
- Response includes per-subject predictions and overall summary

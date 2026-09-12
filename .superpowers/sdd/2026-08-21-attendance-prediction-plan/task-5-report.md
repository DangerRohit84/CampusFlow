# Task 5: Frontend — API Methods

## Status: DONE

## Changes

Added `attendanceAPI` object to `apps/web/src/lib/api.ts` with four methods:

- `parse(text)` — POST `/attendance/parse` with `{ text }`
- `predict(subjects, targetPercentage?)` — POST `/attendance/predict` with `{ subjects, targetPercentage }`
- `save(records, source)` — POST `/attendance/save` with `{ records, source }`
- `getHistory()` — GET `/attendance/history`

All methods follow the existing pattern: use `api.post()`/`api.get()` from the axios instance, chain `.then((r) => r.data)`, and include no comments.

## Commit

- `22d2eb4` — `feat: add attendance API methods`

## Concerns

None. The task brief referenced `apiClient` but the file uses an `api` axios instance, so I used the correct existing variable name.

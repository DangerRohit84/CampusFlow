# Task 5: Frontend — API Methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: Backend endpoints from Tasks 2-4
- Produces: `attendanceAPI` object with `parse`, `predict`, `save`, `getHistory` methods

## Steps

1. Add attendanceAPI to `apps/web/src/lib/api.ts`:

```typescript
export const attendanceAPI = {
  parse: (text: string) =>
    apiClient.post('/attendance/parse', { text }),

  predict: (subjects: any[], targetPercentage?: number) =>
    apiClient.post('/attendance/predict', { subjects, targetPercentage }),

  save: (records: any[], source: string) =>
    apiClient.post('/attendance/save', { records, source }),

  getHistory: () =>
    apiClient.get('/attendance/history'),
};
```

2. Commit: `git add apps/web/src/lib/api.ts && git commit -m "feat: add attendance API methods"`

**Working directory:** `D:\Alpha Coders\CampusFlow`

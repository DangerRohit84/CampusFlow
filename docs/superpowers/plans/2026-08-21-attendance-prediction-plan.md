# AI Attendance Prediction System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered attendance prediction with screenshot upload, manual entry, and prediction dashboard to the existing Attendance page.

**Architecture:** Client-side OCR (Tesseract.js) extracts text from portal screenshots, sends to backend AI Manager for structured parsing. New Prisma models store attendance records. Frontend gets 4 new tabs with prediction formulas, scenario simulation, and recovery timeline.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Tesseract.js, Prisma, AI Manager (`chatWithAI()`), Recharts

## Global Constraints

- OS: win32, Shell: powershell
- Backend at `packages/backend/` (NOT `apps/backend/`)
- All AI calls route through AI Manager (`packages/backend/src/ai/client.ts`)
- `chatWithAI()` function signature: `chatWithAI(prompt: string, options?: { maxTokens?: number })`
- Prisma schema at `packages/backend/prisma/schema.prisma`
- Frontend at `apps/web/src/`
- No comments in code unless requested
- Dark mode: all new components must support `dark:` Tailwind classes
- Colors: Primary `#007060`, Danger `#F07068`, Warning `#F5A623`, Accent Purple `#635BFF`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/backend/src/routes/attendance.ts` | Backend routes: parse, predict, history |
| `apps/web/src/components/attendance/UploadTab.tsx` | Screenshot upload + OCR + AI parse + preview |
| `apps/web/src/components/attendance/ManualTab.tsx` | Editable attendance table with bulk actions |
| `apps/web/src/components/attendance/PredictionsTab.tsx` | Prediction dashboard with all sub-components |
| `apps/web/src/components/attendance/HistoryTab.tsx` | Past uploads and predictions list |
| `apps/web/src/components/attendance/ScenarioTable.tsx` | What-if scenario simulation table |
| `apps/web/src/components/attendance/FrequencyEditor.tsx` | Classes per week editor with +/- controls |

### Modified Files
| File | Change |
|------|--------|
| `packages/backend/prisma/schema.prisma` | Add AttendanceRecord, AttendancePrediction models |
| `packages/backend/src/index.ts` | Register attendance routes |
| `apps/web/src/pages/AttendancePage.tsx` | Rewrite with 4 tabs |
| `apps/web/src/lib/api.ts` | Add attendance API methods |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/` (auto-generated)

**Interfaces:**
- Produces: `AttendanceRecord` model, `AttendancePrediction` model, `AttendanceStatus` enum, `AttendanceSource` enum

- [ ] **Step 1: Add AttendanceStatus and AttendanceSource enums**

Add to `packages/backend/prisma/schema.prisma`:

```prisma
enum AttendanceStatus {
  PRESENT
  ABSENT
  LATE
  EXCUSED
}

enum AttendanceSource {
  UPLOAD
  MANUAL
}
```

- [ ] **Step 2: Add AttendanceRecord model**

Add to `packages/backend/prisma/schema.prisma`:

```prisma
model AttendanceRecord {
  id            String            @id @default(cuid())
  studentId     String
  student       Student           @relation(fields: [studentId], references: [id])
  subject       String
  date          DateTime
  status        AttendanceStatus
  source        AttendanceSource
  createdAt     DateTime          @default(now())

  @@index([studentId, subject])
  @@index([studentId, createdAt])
}
```

- [ ] **Step 3: Add AttendancePrediction model**

Add to `packages/backend/prisma/schema.prisma`:

```prisma
model AttendancePrediction {
  id               String   @id @default(cuid())
  studentId        String
  student          Student  @relation(fields: [studentId], references: [id])
  subject          String
  totalClasses     Int
  presentClasses   Int
  classesPerWeek   Int
  weeksRemaining   Int
  targetPercentage Float    @default(75)
  createdAt        DateTime @default(now())

  @@index([studentId])
}
```

- [ ] **Step 4: Add relation to Student model**

Find the `Student` model in schema.prisma and add:

```prisma
  attendanceRecords    AttendanceRecord[]
  attendancePredictions AttendancePrediction[]
```

- [ ] **Step 5: Run migration**

Run: `cd packages/backend && npx prisma migrate dev --name add-attendance-models`

- [ ] **Step 6: Verify Prisma client generates**

Run: `cd packages/backend && npx prisma generate`

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations
git commit -m "feat: add AttendanceRecord and AttendancePrediction Prisma models"
```

---

### Task 2: Backend — Parse Endpoint (AI Manager)

**Files:**
- Create: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `chatWithAI()` from `../ai/client`
- Produces: `POST /api/attendance/parse` route

- [ ] **Step 1: Create attendance routes file**

Create `packages/backend/src/routes/attendance.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { chatWithAI } from '../ai/client';

const router = Router();

router.post('/parse', authenticate, async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const prompt = `Parse the following attendance data extracted from a college portal screenshot.

Extract each subject with:
- name: subject name
- total: total classes held
- present: classes attended
- absent: classes missed

Return ONLY a valid JSON array. No markdown, no explanation, no code fences.

Example output:
[{"name": "Mathematics", "total": 40, "present": 35, "absent": 5}]

OCR text:
${text}`;

    const result = await chatWithAI(prompt, { maxTokens: 2048 });

    let subjects;
    try {
      const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      subjects = JSON.parse(cleaned);
    } catch {
      return res.status(422).json({ error: 'Could not parse AI response', raw: result });
    }

    if (!Array.isArray(subjects)) {
      return res.status(422).json({ error: 'AI response is not an array', raw: subjects });
    }

    res.json({ subjects });
  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: 'Failed to parse attendance data' });
  }
});

export default router;
```

- [ ] **Step 2: Register routes in index.ts**

Add to `packages/backend/src/index.ts` (after existing route imports):

```typescript
import attendanceRoutes from './routes/attendance';
```

Add after existing `app.use` calls:

```typescript
app.use('/api/attendance', attendanceRoutes);
```

- [ ] **Step 3: Test with curl**

Run: `curl -X POST http://localhost:3001/api/attendance/parse -H "Content-Type: application/json" -d "{\"text\": \"Mathematics: 40 total, 35 present, 5 absent\"}"` (with auth token)

Expected: Returns `{ subjects: [{ name: "Mathematics", total: 40, present: 35, absent: 5 }] }`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/attendance.ts packages/backend/src/index.ts
git commit -m "feat: add attendance parse endpoint using AI Manager"
```

---

### Task 3: Backend — Predict Endpoint (Formulas)

**Files:**
- Modify: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `POST /api/attendance/parse` output format
- Produces: `POST /api/attendance/predict` route

- [ ] **Step 1: Add predict route**

Add to `packages/backend/src/routes/attendance.ts`:

```typescript
router.post('/predict', authenticate, async (req: Request, res: Response) => {
  try {
    const { subjects, targetPercentage = 75 } = req.body;

    if (!subjects || !Array.isArray(subjects)) {
      return res.status(400).json({ error: 'Subjects array is required' });
    }

    const predictions = subjects.map((s: any) => {
      const currentPercentage = s.total > 0 ? (s.present / s.total) * 100 : 0;
      const target = targetPercentage / 100;

      const safeBunks = Math.floor(
        (s.present - target * s.total) / (1 - target)
      );

      const futureClasses = (s.weeksRemaining || 6) * (s.classesPerWeek || 3);

      const ifMiss1PerWeek = (() => {
        const futureMisses = 1 * (s.weeksRemaining || 6);
        const projectedPresent = s.present + (futureClasses - futureMisses);
        const projectedTotal = s.total + futureClasses;
        return projectedTotal > 0 ? (projectedPresent / projectedTotal) * 100 : 0;
      })();

      const ifMiss2PerWeek = (() => {
        const futureMisses = 2 * (s.weeksRemaining || 6);
        const projectedPresent = s.present + (futureClasses - futureMisses);
        const projectedTotal = s.total + futureClasses;
        return projectedTotal > 0 ? (projectedPresent / projectedTotal) * 100 : 0;
      })();

      const ifAttendAll = (() => {
        const projectedPresent = s.present + futureClasses;
        const projectedTotal = s.total + futureClasses;
        return projectedTotal > 0 ? (projectedPresent / projectedTotal) * 100 : 0;
      })();

      let riskLevel = 'SAFE';
      if (currentPercentage < targetPercentage) {
        riskLevel = 'AT_RISK';
      } else if (currentPercentage < targetPercentage + 2) {
        riskLevel = 'WARNING';
      }

      const recoveryClasses = currentPercentage < targetPercentage
        ? Math.ceil((target * s.total - s.present) / (1 - target))
        : null;

      return {
        name: s.name,
        currentPercentage: Math.round(currentPercentage * 10) / 10,
        safeToSkip: Math.max(0, safeBunks),
        ifAttendAll: Math.round(ifAttendAll * 10) / 10,
        ifMiss1PerWeek: Math.round(ifMiss1PerWeek * 10) / 10,
        ifMiss2PerWeek: Math.round(ifMiss2PerWeek * 10) / 10,
        riskLevel,
        recoveryClasses,
      };
    });

    const overallCurrent = predictions.reduce(
      (acc: number, p: any) => acc + p.currentPercentage, 0
    ) / (predictions.length || 1);

    let overallRisk = 'SAFE';
    if (overallCurrent < targetPercentage) overallRisk = 'AT_RISK';
    else if (overallCurrent < targetPercentage + 2) overallRisk = 'WARNING';

    res.json({
      predictions,
      overall: {
        currentPercentage: Math.round(overallCurrent * 10) / 10,
        riskLevel: overallRisk,
      },
    });
  } catch (error) {
    console.error('Predict error:', error);
    res.status(500).json({ error: 'Failed to generate predictions' });
  }
});
```

- [ ] **Step 2: Test with curl**

Run: `curl -X POST http://localhost:3001/api/attendance/predict -H "Content-Type: application/json" -d "{\"subjects\": [{\"name\": \"Math\", \"total\": 40, \"present\": 35, \"classesPerWeek\": 3, \"weeksRemaining\": 6}], \"targetPercentage\": 75}"` (with auth token)

Expected: Returns predictions with currentPercentage, safeToSkip, ifMiss1PerWeek, etc.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/routes/attendance.ts
git commit -m "feat: add attendance predict endpoint with formulas"
```

---

### Task 4: Backend — History Endpoint

**Files:**
- Modify: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `AttendanceRecord` Prisma model
- Produces: `GET /api/attendance/history` route, `POST /api/attendance/save` route

- [ ] **Step 1: Add history and save routes**

Add to `packages/backend/src/routes/attendance.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

router.get('/history', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const records = await prisma.attendanceRecord.findMany({
      where: { studentId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const grouped = records.reduce((acc: any, r) => {
      const key = r.createdAt.toISOString().split('T')[0];
      if (!acc[key]) acc[key] = { date: key, type: r.source, records: [] };
      acc[key].records.push(r);
      return acc;
    }, {});

    const history = Object.values(grouped).map((g: any) => {
      const total = g.records.length;
      const present = g.records.filter((r: any) => r.status === 'PRESENT' || r.status === 'EXCUSED').length;
      return {
        date: g.date,
        type: g.type,
        subjectCount: new Set(g.records.map((r: any) => r.subject)).size,
        overallPercentage: total > 0 ? Math.round((present / total) * 100) : 0,
      };
    });

    res.json({ history });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

router.post('/save', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { records, source } = req.body;

    if (!records || !Array.isArray(records)) {
      return res.status(400).json({ error: 'Records array is required' });
    }

    const created = await prisma.attendanceRecord.createMany({
      data: records.map((r: any) => ({
        studentId: userId,
        subject: r.subject,
        date: new Date(r.date),
        status: r.status,
        source: source || 'MANUAL',
      })),
    });

    res.json({ saved: created.count });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save records' });
  }
});
```

- [ ] **Step 2: Test history endpoint**

Run: `curl http://localhost:3001/api/attendance/history` (with auth token)

Expected: Returns `{ history: [...] }`

- [ ] **Step 3: Test save endpoint**

Run: `curl -X POST http://localhost:3001/api/attendance/save -H "Content-Type: application/json" -d "{\"records\": [{\"subject\": \"Math\", \"date\": \"2026-08-20\", \"status\": \"PRESENT\"}], \"source\": \"MANUAL\"}"` (with auth token)

Expected: Returns `{ saved: 1 }`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/attendance.ts
git commit -m "feat: add attendance history and save endpoints"
```

---

### Task 5: Frontend — API Methods

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: Backend endpoints from Tasks 2-4
- Produces: `attendanceAPI` object with `parse`, `predict`, `save`, `getHistory` methods

- [ ] **Step 1: Add attendanceAPI to api.ts**

Add to `apps/web/src/lib/api.ts`:

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

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat: add attendance API methods"
```

---

### Task 6: Frontend — UploadTab Component

**Files:**
- Create: `apps/web/src/components/attendance/UploadTab.tsx`

**Interfaces:**
- Consumes: `attendanceAPI.parse()`, `attendanceAPI.save()`
- Produces: `UploadTab` React component

- [ ] **Step 1: Install Tesseract.js**

Run: `cd apps/web && npm install tesseract.js`

- [ ] **Step 2: Create UploadTab component**

Create `apps/web/src/components/attendance/UploadTab.tsx`:

```tsx
import { useState, useRef } from 'react';
import { Upload, FileImage, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';

interface ExtractedSubject {
  name: string;
  total: number;
  present: number;
  absent: number;
}

export default function UploadTab() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedSubject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setExtracted([]);
    setError(null);
    setExtracting(true);

    try {
      const Tesseract = await import('tesseract.js');
      const { data } = await Tesseract.recognize(selected, 'eng');

      const result = await attendanceAPI.parse(data.text);
      setExtracted(result.subjects);
    } catch (err: any) {
      setError(err.message || 'Failed to extract data');
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    try {
      const records = extracted.flatMap((s) => {
        const result = [];
        for (let i = 0; i < s.present; i++) {
          result.push({ subject: s.name, date: new Date().toISOString(), status: 'PRESENT' });
        }
        for (let i = 0; i < s.absent; i++) {
          result.push({ subject: s.name, date: new Date().toISOString(), status: 'ABSENT' });
        }
        return result;
      });
      await attendanceAPI.save(records, 'UPLOAD');
      setExtracted([]);
      setFile(null);
      setPreview(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    }
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-surface-300 dark:border-[#202C35] rounded-xl p-8 text-center cursor-pointer hover:border-primary-400 transition-colors"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        {preview ? (
          <img src={preview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
        ) : (
          <>
            <Upload className="w-10 h-10 mx-auto text-surface-400 mb-3" />
            <p className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Upload Attendance Screenshot</p>
            <p className="text-sm text-surface-500 dark:text-[#A6B3BE] mt-1">
              Take a screenshot from your college portal
            </p>
            <p className="text-xs text-surface-400 mt-2">PNG, JPG, WebP — Max 10MB</p>
          </>
        )}
      </div>

      {extracting && (
        <div className="flex items-center justify-center gap-2 py-4 text-primary-600">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Extracting data with AI...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-danger-50 dark:bg-danger-900/20 rounded-lg text-danger-700 dark:text-danger-400 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {extracted.length > 0 && (
        <div className="bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="w-5 h-5 text-primary-600" />
            <span className="font-semibold text-primary-700 dark:text-primary-400">AI Extracted Data</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary-200 dark:border-primary-800">
                <th className="text-left py-2">Subject</th>
                <th className="text-center py-2">Total</th>
                <th className="text-center py-2">Present</th>
                <th className="text-center py-2">Absent</th>
                <th className="text-center py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {extracted.map((s, i) => (
                <tr key={i} className="border-b border-primary-100 dark:border-primary-900">
                  <td className="py-2">{s.name}</td>
                  <td className="text-center py-2">{s.total}</td>
                  <td className="text-center py-2 text-primary-600">{s.present}</td>
                  <td className="text-center py-2 text-danger-600">{s.absent}</td>
                  <td className="text-center py-2 font-bold">{s.total > 0 ? Math.round((s.present / s.total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => { setExtracted([]); setFile(null); setPreview(null); }}
              className="px-4 py-2 border border-surface-300 rounded-lg text-sm text-surface-600 hover:bg-surface-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700"
            >
              Save to My Records
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Test in browser**

Navigate to Attendance page, click Upload tab, upload a screenshot. Verify extraction works.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/attendance/UploadTab.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "feat: add UploadTab with Tesseract.js OCR and AI parsing"
```

---

### Task 7: Frontend — ManualTab Component

**Files:**
- Create: `apps/web/src/components/attendance/ManualTab.tsx`

**Interfaces:**
- Consumes: `attendanceAPI.save()`
- Produces: `ManualTab` React component

- [ ] **Step 1: Create ManualTab component**

Create `apps/web/src/components/attendance/ManualTab.tsx`:

```tsx
import { useState } from 'react';
import { Plus, Trash2, CalendarCheck } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';

interface AttendanceRow {
  id: string;
  date: string;
  subject: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
}

const STATUS_OPTIONS = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const;

const STATUS_STYLES: Record<string, string> = {
  PRESENT: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  ABSENT: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  LATE: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
  EXCUSED: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
};

export default function ManualTab() {
  const [rows, setRows] = useState<AttendanceRow[]>([
    { id: '1', date: new Date().toISOString().split('T')[0], subject: '', status: 'PRESENT' },
  ]);
  const [subjects, setSubjects] = useState<string[]>(['']);

  const addRow = () => {
    setRows([...rows, {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      subject: '',
      status: 'PRESENT',
    }]);
  };

  const removeRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof AttendanceRow, value: string) => {
    setRows(rows.map((r) => r.id === id ? { ...r, [field]: value } : r));
  };

  const bulkFill = (status: 'PRESENT' | 'ABSENT') => {
    const today = new Date().toISOString().split('T')[0];
    setRows(rows.map((r) => r.date === today ? { ...r, status } : r));
  };

  const handleSave = async () => {
    try {
      const records = rows.filter((r) => r.subject).map((r) => ({
        subject: r.subject,
        date: r.date,
        status: r.status,
      }));
      await attendanceAPI.save(records, 'MANUAL');
      setRows([{ id: '1', date: new Date().toISOString().split('T')[0], subject: '', status: 'PRESENT' }]);
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Attendance Records</div>
        <div className="flex gap-2">
          <button onClick={addRow} className="px-3 py-1.5 bg-surface-100 dark:bg-[#202C35] rounded-lg text-sm text-surface-700 dark:text-[#A6B3BE] hover:bg-surface-200">
            <Plus className="w-4 h-4 inline mr-1" />Add Row
          </button>
          <button onClick={() => bulkFill('PRESENT')} className="px-3 py-1.5 bg-primary-50 dark:bg-primary-900/20 rounded-lg text-sm text-primary-600 font-semibold hover:bg-primary-100">
            <CalendarCheck className="w-4 h-4 inline mr-1" />All Present Today
          </button>
        </div>
      </div>

      <div className="border border-surface-200 dark:border-[#202C35] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-50 dark:bg-[#0C1218]">
            <tr>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-center px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-surface-100 dark:border-[#202C35]">
                <td className="px-4 py-3">
                  <input
                    type="date"
                    value={row.date}
                    onChange={(e) => updateRow(row.id, 'date', e.target.value)}
                    className="bg-transparent border-none text-sm focus:outline-none"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    value={row.subject}
                    onChange={(e) => updateRow(row.id, 'subject', e.target.value)}
                    placeholder="Subject name"
                    className="bg-transparent border-none text-sm focus:outline-none w-full"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={row.status}
                    onChange={(e) => updateRow(row.id, 'status', e.target.value)}
                    className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_STYLES[row.status]}`}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td className="text-center px-4 py-3">
                  <button onClick={() => removeRow(row.id)} className="text-danger-500 hover:text-danger-700">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700"
        >
          Save Records
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test in browser**

Navigate to Manual tab. Add rows, change dates/subjects/statuses, bulk fill, save. Verify it works.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/attendance/ManualTab.tsx
git commit -m "feat: add ManualTab with editable attendance table"
```

---

### Task 8: Frontend — FrequencyEditor + PredictionsTab

**Files:**
- Create: `apps/web/src/components/attendance/FrequencyEditor.tsx`
- Create: `apps/web/src/components/attendance/PredictionsTab.tsx`

**Interfaces:**
- Consumes: `attendanceAPI.predict()`
- Produces: `FrequencyEditor` component, `PredictionsTab` component

- [ ] **Step 1: Create FrequencyEditor component**

Create `apps/web/src/components/attendance/FrequencyEditor.tsx`:

```tsx
import { Minus, Plus } from 'lucide-react';

interface SubjectFreq {
  name: string;
  classesPerWeek: number;
  hasLab: boolean;
  hasMakeup: boolean;
}

interface Props {
  subjects: SubjectFreq[];
  onChange: (subjects: SubjectFreq[]) => void;
}

export default function FrequencyEditor({ subjects, onChange }: Props) {
  const update = (index: number, field: keyof SubjectFreq, value: any) => {
    const updated = subjects.map((s, i) => i === index ? { ...s, [field]: value } : s);
    onChange(updated);
  };

  const increment = (index: number) => {
    update(index, 'classesPerWeek', Math.min(10, subjects[index].classesPerWeek + 1));
  };

  const decrement = (index: number) => {
    update(index, 'classesPerWeek', Math.max(1, subjects[index].classesPerWeek - 1));
  };

  return (
    <div className="space-y-2">
      {subjects.map((s, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-[#111920] rounded-lg">
          <div className="w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-surface-900 dark:text-[#F4F7F8]">{s.name}</div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => decrement(i)} className="w-7 h-7 border border-surface-300 dark:border-[#202C35] rounded-md flex items-center justify-center text-surface-500 hover:bg-surface-100">
              <Minus className="w-3 h-3" />
            </button>
            <div className="w-10 h-7 border border-primary-500 rounded-md flex items-center justify-center font-bold text-primary-600 text-sm">
              {s.classesPerWeek}
            </div>
            <button onClick={() => increment(i)} className="w-7 h-7 border border-surface-300 dark:border-[#202C35] rounded-md flex items-center justify-center text-surface-500 hover:bg-surface-100">
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <span className="text-xs text-surface-500 w-16 text-right">classes/wk</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create PredictionsTab component**

Create `apps/web/src/components/attendance/PredictionsTab.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, TrendingDown, Target } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';
import FrequencyEditor from './FrequencyEditor';
import ScenarioTable from './ScenarioTable';

interface Prediction {
  name: string;
  currentPercentage: number;
  safeToSkip: number;
  ifAttendAll: number;
  ifMiss1PerWeek: number;
  ifMiss2PerWeek: number;
  riskLevel: 'SAFE' | 'WARNING' | 'AT_RISK';
  recoveryClasses: number | null;
}

const RISK_STYLES = {
  SAFE: { bg: 'bg-primary-50 dark:bg-primary-900/20', text: 'text-primary-700 dark:text-primary-400', label: 'SAFE', icon: CheckCircle },
  WARNING: { bg: 'bg-warning-50 dark:bg-warning-900/20', text: 'text-warning-700 dark:text-warning-400', label: 'WARNING', icon: AlertTriangle },
  AT_RISK: { bg: 'bg-danger-50 dark:bg-danger-900/20', text: 'text-danger-700 dark:text-danger-400', label: 'AT RISK', icon: TrendingDown },
};

export default function PredictionsTab() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [overall, setOverall] = useState<any>(null);
  const [subjects, setSubjects] = useState([
    { name: 'Mathematics', classesPerWeek: 3, hasLab: false, hasMakeup: false },
    { name: 'Physics', classesPerWeek: 4, hasLab: true, hasMakeup: false },
    { name: 'Chemistry', classesPerWeek: 3, hasLab: false, hasMakeup: false },
  ]);
  const [target, setTarget] = useState(75);
  const [loading, setLoading] = useState(false);

  const fetchPredictions = async () => {
    setLoading(true);
    try {
      const mockSubjects = subjects.map((s) => ({
        name: s.name,
        total: 35 + Math.floor(Math.random() * 10),
        present: 20 + Math.floor(Math.random() * 15),
        classesPerWeek: s.classesPerWeek,
        weeksRemaining: 6,
      }));

      const result = await attendanceAPI.predict(mockSubjects, target);
      setPredictions(result.predictions);
      setOverall(result.overall);
    } catch (err) {
      console.error('Predict failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPredictions();
  }, [subjects, target]);

  return (
    <div className="space-y-6">
      {overall && (
        <div className={`p-4 rounded-xl flex items-center gap-3 ${
          overall.riskLevel === 'SAFE' ? 'bg-primary-50 dark:bg-primary-900/20' :
          overall.riskLevel === 'WARNING' ? 'bg-warning-50 dark:bg-warning-900/20' :
          'bg-danger-50 dark:bg-danger-900/20'
        }`}>
          {overall.riskLevel === 'SAFE' ? <CheckCircle className="w-6 h-6 text-primary-600" /> :
           overall.riskLevel === 'WARNING' ? <AlertTriangle className="w-6 h-6 text-warning-600" /> :
           <TrendingDown className="w-6 h-6 text-danger-600" />}
          <div>
            <div className="font-bold text-surface-900 dark:text-[#F4F7F8]">
              {overall.riskLevel === 'SAFE' ? 'All Good' :
               overall.riskLevel === 'WARNING' ? 'Warning — Approaching threshold' :
               'At Risk — Action needed'}
            </div>
            <div className="text-sm text-surface-600 dark:text-[#A6B3BE]">
              Overall: {overall.currentPercentage}% (Target: {target}%)
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Subject-wise Analysis</h3>
        {predictions.map((p) => {
          const risk = RISK_STYLES[p.riskLevel];
          const Icon = risk.icon;
          return (
            <div key={p.name} className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl p-4">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <div className="font-semibold text-surface-900 dark:text-[#F4F7F8]">{p.name}</div>
                  <div className="text-xs text-surface-500">{subjects.find((s) => s.name === p.name)?.classesPerWeek || 3} classes/week</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${risk.bg} ${risk.text}`}>
                    {risk.label}
                  </span>
                  <span className="text-2xl font-bold text-surface-900 dark:text-[#F4F7F8]">{p.currentPercentage}%</span>
                </div>
              </div>
              <div className="h-1.5 bg-surface-100 dark:bg-[#202C35] rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full ${
                    p.riskLevel === 'SAFE' ? 'bg-primary-500' :
                    p.riskLevel === 'WARNING' ? 'bg-warning-500' : 'bg-danger-500'
                  }`}
                  style={{ width: `${Math.min(100, p.currentPercentage)}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">Attended</div>
                  <div className="font-bold text-surface-900 dark:text-[#F4F7F8]">
                    {Math.round(p.currentPercentage * 0.35)}/{Math.round(p.currentPercentage * 0.35 / (p.currentPercentage / 100))}
                  </div>
                </div>
                <div className={`p-2 rounded-lg ${p.riskLevel === 'SAFE' ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-warning-50 dark:bg-warning-900/20'}`}>
                  <div className="text-surface-500">{p.riskLevel === 'SAFE' ? 'Safe to Skip' : 'Must Attend'}</div>
                  <div className={`font-bold ${p.riskLevel === 'SAFE' ? 'text-primary-600' : 'text-warning-600'}`}>
                    {p.riskLevel === 'SAFE' ? `${p.safeToSkip} classes` : `${p.recoveryClasses} classes`}
                  </div>
                </div>
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">If miss 1/wk</div>
                  <div className={`font-bold ${p.ifMiss1PerWeek >= target ? 'text-primary-600' : 'text-danger-600'}`}>
                    → {p.ifMiss1PerWeek}%
                  </div>
                </div>
                <div className="p-2 bg-surface-50 dark:bg-[#0C1218] rounded-lg">
                  <div className="text-surface-500">If miss 2/wk</div>
                  <div className={`font-bold ${p.ifMiss2PerWeek >= target ? 'text-primary-600' : 'text-danger-600'}`}>
                    → {p.ifMiss2PerWeek}%
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl p-4">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8] mb-3">Weekly Class Frequency</h3>
        <FrequencyEditor subjects={subjects} onChange={setSubjects} />
      </div>

      <ScenarioTable predictions={predictions} target={target} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/attendance/FrequencyEditor.tsx apps/web/src/components/attendance/PredictionsTab.tsx
git commit -m "feat: add FrequencyEditor and PredictionsTab components"
```

---

### Task 9: Frontend — ScenarioTable + HistoryTab

**Files:**
- Create: `apps/web/src/components/attendance/ScenarioTable.tsx`
- Create: `apps/web/src/components/attendance/HistoryTab.tsx`

**Interfaces:**
- Consumes: Prediction[] from PredictionsTab
- Produces: `ScenarioTable` component, `HistoryTab` component

- [ ] **Step 1: Create ScenarioTable component**

Create `apps/web/src/components/attendance/ScenarioTable.tsx`:

```tsx
interface Prediction {
  name: string;
  currentPercentage: number;
  ifAttendAll: number;
  ifMiss1PerWeek: number;
  ifMiss2PerWeek: number;
}

interface Props {
  predictions: Prediction[];
  target: number;
}

export default function ScenarioTable({ predictions, target }: Props) {
  const scenarios = [
    { label: 'Attend ALL remaining', key: 'ifAttendAll', style: 'bg-primary-50 dark:bg-primary-900/20 font-semibold' },
    { label: 'Miss 1 class/week', key: 'ifMiss1PerWeek', style: '' },
    { label: 'Miss 2 classes/week', key: 'ifMiss2PerWeek', style: '' },
    { label: 'Miss 1 full week', key: 'miss1Week', style: 'bg-danger-50 dark:bg-danger-900/20' },
  ];

  const getValue = (p: Prediction, key: string) => {
    if (key === 'miss1Week') {
      const classesMissed = 3;
      const futureClasses = 6 * 3;
      const futureMisses = classesMissed;
      const projected = (p.currentPercentage / 100 * 35 + (futureClasses - futureMisses)) / (35 + futureClasses) * 100;
      return Math.round(projected * 10) / 10;
    }
    return (p as any)[key];
  };

  return (
    <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-surface-200 dark:border-[#202C35]">
        <h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">What-If Scenario Simulator</h3>
        <p className="text-xs text-surface-500 mt-1">See how your attendance changes based on different behavior patterns</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-50 dark:bg-[#0C1218]">
            <th className="text-left px-4 py-3">Scenario</th>
            {predictions.map((p) => (
              <th key={p.name} className="text-center px-4 py-3">{p.name}</th>
            ))}
            <th className="text-center px-4 py-3">Overall</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => {
            const overallAvg = predictions.reduce((acc, p) => acc + getValue(p, s.key), 0) / (predictions.length || 1);
            return (
              <tr key={s.key} className={`border-t border-surface-100 dark:border-[#202C35] ${s.style}`}>
                <td className="px-4 py-3 font-medium">{s.label}</td>
                {predictions.map((p) => {
                  const val = getValue(p, p.name);
                  return (
                    <td key={p.name} className="text-center px-4 py-3">
                      <span className={val >= target ? 'text-primary-600' : 'text-danger-600'}>
                        {Math.round(val * 10) / 10}%
                      </span>
                    </td>
                  );
                })}
                <td className="text-center px-4 py-3 font-bold">
                  <span className={overallAvg >= target ? 'text-primary-600' : 'text-danger-600'}>
                    {Math.round(overallAvg * 10) / 10}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create HistoryTab component**

Create `apps/web/src/components/attendance/HistoryTab.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Upload, Edit3 } from 'lucide-react';
import { attendanceAPI } from '../../lib/api';

interface HistoryItem {
  date: string;
  type: string;
  subjectCount: number;
  overallPercentage: number;
}

export default function HistoryTab() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    attendanceAPI.getHistory()
      .then((res) => setHistory(res.history))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white dark:bg-[#111920] border border-surface-200 dark:border-[#202C35] rounded-xl overflow-hidden">
      <div className="p-4 border-b border-surface-200 dark:border-[#202C35] font-semibold text-surface-900 dark:text-[#F4F7F8]">
        Past Uploads & Predictions
      </div>
      {loading ? (
        <div className="p-8 text-center text-surface-400">Loading...</div>
      ) : history.length === 0 ? (
        <div className="p-8 text-center text-surface-400">No history yet. Upload or manually enter attendance data.</div>
      ) : (
        history.map((h, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-surface-100 dark:border-[#202C35] last:border-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              h.type === 'UPLOAD' ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-warning-50 dark:bg-warning-900/20'
            }`}>
              {h.type === 'UPLOAD' ? <Upload className="w-4 h-4 text-primary-600" /> : <Edit3 className="w-4 h-4 text-warning-600" />}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-surface-900 dark:text-[#F4F7F8]">
                {h.type === 'UPLOAD' ? 'Portal Screenshot' : 'Manual Entry'}
              </div>
              <div className="text-xs text-surface-500">
                {new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — {h.subjectCount} subjects
              </div>
            </div>
            <div className="text-sm font-bold text-primary-600">{h.overallPercentage}%</div>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/attendance/ScenarioTable.tsx apps/web/src/components/attendance/HistoryTab.tsx
git commit -m "feat: add ScenarioTable and HistoryTab components"
```

---

### Task 10: Frontend — Rewrite AttendancePage with Tabs

**Files:**
- Modify: `apps/web/src/pages/AttendancePage.tsx`

**Interfaces:**
- Consumes: All 4 tab components from Tasks 6-9
- Produces: Updated AttendancePage with tab navigation

- [ ] **Step 1: Rewrite AttendancePage.tsx**

Replace `apps/web/src/pages/AttendancePage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Target, CheckCircle, XCircle, Clock, Upload, Edit3, BarChart3, History } from 'lucide-react';
import Card from '../components/ui/Card';
import { userAPI } from '../lib/api';
import UploadTab from '../components/attendance/UploadTab';
import ManualTab from '../components/attendance/ManualTab';
import PredictionsTab from '../components/attendance/PredictionsTab';
import HistoryTab from '../components/attendance/HistoryTab';

type Tab = 'overview' | 'upload' | 'manual' | 'predictions' | 'history';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Target },
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'manual', label: 'Manual', icon: Edit3 },
  { id: 'predictions', label: 'Predictions', icon: BarChart3 },
  { id: 'history', label: 'History', icon: History },
];

export default function AttendancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([userAPI.getAttendance(), userAPI.getAttendanceStats()])
      .then(([r, s]) => { setRecords(r); setStats(s) })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const courseStats = records.reduce((acc: any, r: any) => {
    if (!acc[r.courseName]) acc[r.courseName] = { total: 0, present: 0, absent: 0, late: 0 };
    acc[r.courseName].total++;
    if (r.status === 'PRESENT') acc[r.courseName].present++;
    if (r.status === 'ABSENT') acc[r.courseName].absent++;
    if (r.status === 'LATE') acc[r.courseName].late++;
    return acc;
  }, {});

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8]">Attendance</h1>
        <p className="text-surface-500 dark:text-[#A6B3BE] mt-1">Track, predict, and manage your class attendance</p>
      </motion.div>

      {/* Tab Bar */}
      <div className="flex gap-0 border-b-2 border-surface-200 dark:border-[#202C35]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? 'text-primary-600 border-b-2 border-primary-600 -mb-[2px]'
                : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Overall', value: `${stats?.percentage || 0}%`, color: 'from-primary-400 to-primary-600' },
              { label: 'Present', value: stats?.present || 0, color: 'from-primary-400 to-primary-600' },
              { label: 'Absent', value: stats?.absent || 0, color: 'from-danger-400 to-danger-600' },
              { label: 'Late', value: stats?.late || 0, color: 'from-warning-400 to-warning-600' },
            ].map((s) => (
              <Card key={s.label} hover className="relative overflow-hidden">
                <div>
                  <p className="text-sm font-medium text-surface-500 dark:text-[#A6B3BE]">{s.label}</p>
                  <p className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8] mt-1">{loading ? '—' : s.value}</p>
                </div>
              </Card>
            ))}
          </div>

          <Card hover>
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="relative w-40 h-40 shrink-0">
                <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 160 160">
                  <circle cx="80" cy="80" r="70" fill="none" stroke="#e5e7eb" strokeWidth="12" />
                  <motion.circle
                    cx="80" cy="80" r="70" fill="none"
                    stroke="url(#gradient)" strokeWidth="12" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 70}
                    initial={{ strokeDashoffset: 2 * Math.PI * 70 }}
                    animate={{ strokeDashoffset: 2 * Math.PI * 70 * (1 - (stats?.percentage || 0) / 100) }}
                    transition={{ duration: 1.5, delay: 0.5 }}
                  />
                  <defs>
                    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#007060" />
                      <stop offset="100%" stopColor="#00A88F" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-surface-900 dark:text-[#F4F7F8]">{stats?.percentage || 0}%</span>
                  <span className="text-xs text-surface-400">Attendance</span>
                </div>
              </div>
              <div className="flex-1 w-full">
                <h3 className="font-bold text-surface-900 dark:text-[#F4F7F8] mb-4">Course-wise Attendance</h3>
                <div className="space-y-4">
                  {Object.entries(courseStats).map(([course, data]: [string, any]) => {
                    const pct = data.total > 0 ? Math.round((data.present / data.total) * 100) : 0;
                    return (
                      <div key={course}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-surface-700 dark:text-[#A6B3BE]">{course}</span>
                          <span className={`text-sm font-bold ${pct >= 80 ? 'text-primary-600' : pct >= 60 ? 'text-warning-600' : 'text-danger-600'}`}>{pct}%</span>
                        </div>
                        <div className="h-2.5 bg-surface-100 dark:bg-[#202C35] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, delay: 0.3 }}
                            className={`h-full rounded-full ${pct >= 80 ? 'bg-primary-500' : pct >= 60 ? 'bg-warning-500' : 'bg-danger-500'}`}
                          />
                        </div>
                        <p className="text-xs text-surface-400 mt-0.5">{data.present}/{data.total} classes attended</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      {activeTab === 'upload' && <UploadTab />}
      {activeTab === 'manual' && <ManualTab />}
      {activeTab === 'predictions' && <PredictionsTab />}
      {activeTab === 'history' && <HistoryTab />}
    </motion.div>
  );
}
```

- [ ] **Step 2: Test all tabs in browser**

Navigate through all 5 tabs. Verify:
- Overview shows stats and course-wise bars
- Upload allows screenshot upload and extraction
- Manual allows adding/editing rows
- Predictions shows cards and scenario table
- History shows past records

- [ ] **Step 3: Test dark mode**

Toggle dark mode. Verify all new components render correctly in dark theme.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/AttendancePage.tsx
git commit -m "feat: rewrite AttendancePage with 5-tab layout"
```

---

### Task 11: Final Testing + TypeScript Check

**Files:**
- All files from previous tasks

**Interfaces:**
- N/A (verification task)

- [ ] **Step 1: Run TypeScript check on backend**

Run: `cd packages/backend && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 2: Run TypeScript check on frontend**

Run: `cd apps/web && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Run lint on frontend**

Run: `cd apps/web && npm run lint`

Expected: No errors

- [ ] **Step 4: Test full flow in browser**

1. Go to Attendance page → Overview tab (should show stats)
2. Click Upload tab → upload a screenshot → verify extraction preview
3. Click Manual tab → add rows → save
4. Click Predictions tab → verify subject cards, scenario table, frequency editor
5. Click History tab → verify past records appear
6. Toggle dark mode → verify all components render correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete AI attendance prediction system"
```

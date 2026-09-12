# AI Attendance Prediction System — Design Spec

**Date:** 2026-08-21
**Status:** Approved
**Author:** CampusFlow Team

---

## Overview

Add an AI-powered attendance prediction system to the existing Attendance page. Students can upload portal screenshots or manually enter attendance data, and the system provides predictions, risk alerts, scenario simulations, and recovery plans.

---

## Goals

1. Let students import attendance data from college portal screenshots (OCR + AI)
2. Let students manually enter attendance records in a table
3. Provide AI-powered predictions: safe bunk calculator, risk alerts, trend analysis, recovery path
4. Support scenario simulation: "what if I miss 1 class/week vs 2?"
5. Track classes per week per subject for accurate predictions

---

## Non-Goals

- Face recognition or biometric attendance
- Real-time college portal integration (sandyy.in-style)
- Attendance correction requests
- Professor/admin attendance marking

---

## User Flow

### Upload Flow
```
Student uploads portal screenshot
        ↓
Tesseract.js runs OCR (client-side, image stays in browser)
        ↓
Extracted text sent to backend → AI (Groq/Gemini via AI Manager)
        ↓
AI returns structured JSON:
{
  subjects: [
    { name: "Mathematics", total: 40, present: 35, absent: 5 },
    { name: "Physics", total: 38, present: 28, absent: 10 }
  ]
}
        ↓
Student sees preview table → clicks "Save"
        ↓
Saved to DB → appears in Predictions tab
```

### Manual Flow
```
Student clicks "Manual" tab
        ↓
Fills table: Date, Subject, Status (Present/Absent/Late/Excused)
        ↓
Can bulk fill: "All present today"
        ↓
Saves records → feeds into predictions
```

### Prediction Flow
```
Student clicks "Predictions" tab
        ↓
System calculates per-subject:
  - Current %
  - Safe to skip X classes
  - If miss 1/week → Y%
  - If miss 2/week → Z%
  - Recovery: attend N consecutive classes
        ↓
Shows scenario simulation table
        ↓
Shows recovery timeline
```

---

## Page Structure

### Tab Layout

```
[Overview] [Upload] [Manual] [Predictions] [History]
```

**Overview** — Existing stats cards, attendance ring, course-wise bars (stays as-is)
**Upload** — Screenshot upload → AI extraction preview → Save
**Manual** — Editable table (Date, Subject, Status) with bulk actions
**Predictions** — Full prediction dashboard with scenario simulation
**History** — Past uploads and predictions

---

## Components

### 1. UploadTab

- Drag-and-drop zone for image upload (PNG, JPG, WebP, max 10MB)
- Client-side OCR using Tesseract.js
- AI parsing via backend `/api/attendance/parse`
- Preview table showing extracted data
- Save button to persist records

### 2. ManualTab

- Editable table with columns: Date, Subject, Status
- Add Row button
- Bulk fill buttons: "All present today", "All absent today"
- Delete row (✕ button)
- Status dropdown: Present, Absent, Late, Excused
- Save Records button

### 3. PredictionsTab

**Risk Status Banner:**
- 🟢 Safe — All subjects above threshold
- 🟡 Warning — 1+ subjects within ±2% of threshold
- 🔴 At Risk — 1+ subjects below threshold

**Subject-wise Prediction Cards:**
- Subject name + classes/week + weeks remaining
- Current % with color-coded badge (🟢/🟡/🔴)
- Progress bar
- 4 stats: Attended, Safe to Skip/Must Attend, If miss 1/week, If miss 2/week

**What-If Scenario Simulator:**
- Table: Rows = scenarios (attend all, miss 1/week, miss 2/week, miss 1 full week)
- Columns = subjects + overall
- Color-coded results

**Weekly Class Frequency Editor:**
- Per-subject: name, theory/lab, classes/week input (+/−)
- Toggle for makeup/lab sessions
- Add Subject button

**Semester Settings:**
- Target attendance % (default 75%)
- Weeks remaining
- Total semester classes

**Plan Future Absences:**
- Per-subject: planned misses input
- Live preview: "Will drop to X% ⚠️"

**Recovery Timeline:**
- Visual timeline: Today → Week 2 → Week 4 → Semester End
- Shows projected % at each milestone

### 4. HistoryTab

- List of past uploads (screenshot vs manual)
- Timestamp, # subjects extracted, overall %
- Click to view details

---

## Backend Endpoints

### `POST /api/attendance/parse`

**Request:**
```json
{
  "text": "OCR extracted text from screenshot"
}
```

**Response:**
```json
{
  "subjects": [
    {
      "name": "Mathematics",
      "total": 40,
      "present": 35,
      "absent": 5
    }
  ]
}
```

**Implementation:**
- Receives OCR text from frontend
- Calls `chatWithAI()` from AI Manager (`packages/backend/src/ai/client.ts`) with structured prompt
- AI Manager routes to configured provider (Groq/Gemini)
- AI parses text into JSON
- Returns structured data
- **All AI calls go through AI Manager** — no direct provider calls

### `POST /api/attendance/predict`

**Request:**
```json
{
  "subjects": [
    {
      "name": "Mathematics",
      "total": 40,
      "present": 35,
      "classesPerWeek": 3,
      "weeksRemaining": 6,
      "plannedMisses": 0
    }
  ],
  "targetPercentage": 75
}
```

**Response:**
```json
{
  "subjects": [
    {
      "name": "Mathematics",
      "currentPercentage": 87.5,
      "safeToSkip": 3,
      "ifMiss1PerWeek": 82.1,
      "ifMiss2PerWeek": 76.8,
      "riskLevel": "SAFE",
      "recoveryNeeded": null
    }
  ],
  "overall": {
    "currentPercentage": 70.0,
    "riskLevel": "WARNING"
  }
}
```

### `GET /api/attendance/history`

**Response:**
```json
{
  "records": [
    {
      "id": "...",
      "type": "UPLOAD" | "MANUAL",
      "date": "2026-08-18",
      "subjectCount": 5,
      "overallPercentage": 82
    }
  ]
}
```

---

## Data Model

### New Prisma Model: `AttendanceRecord`

```prisma
model AttendanceRecord {
  id            String   @id @default(cuid())
  studentId     String
  student       Student  @relation(fields: [studentId], references: [id])
  subject       String
  date          DateTime
  status        AttendanceStatus
  source        AttendanceSource  // UPLOAD or MANUAL
  createdAt     DateTime @default(now())
  
  @@index([studentId, subject])
}

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

### New Prisma Model: `AttendancePrediction`

```prisma
model AttendancePrediction {
  id              String   @id @default(cuid())
  studentId       String
  student         Student  @relation(fields: [studentId], references: [id])
  subject         String
  totalClasses    Int
  presentClasses  Int
  classesPerWeek  Int
  weeksRemaining  Int
  targetPercentage Float   @default(75)
  createdAt       DateTime @default(now())
  
  @@index([studentId])
}
```

---

## AI Prompt for OCR Parsing

```
Parse the following attendance data extracted from a college portal screenshot.

Extract each subject with:
- name: subject name
- total: total classes held
- present: classes attended
- absent: classes missed

Return ONLY valid JSON array. No markdown, no explanation.

Example output:
[
  {"name": "Mathematics", "total": 40, "present": 35, "absent": 5},
  {"name": "Physics", "total": 38, "present": 28, "absent": 10}
]

OCR text:
{extractedText}
```

---

## Prediction Formulas

### Current Percentage
```
currentPercentage = (presentClasses / totalClasses) * 100
```

### Safe Bunks
```
safeBunks = floor((presentClasses - (targetPercentage/100 * totalClasses)) / (1 - targetPercentage/100))
```
If result is negative, student has no safe bunks.

### If Miss N Per Week
```
futureClasses = weeksRemaining * classesPerWeek
futureMisses = N * weeksRemaining
projectedPresent = presentClasses + (futureClasses - futureMisses)
projectedTotal = totalClasses + futureClasses
projectedPercentage = (projectedPresent / projectedTotal) * 100
```

### Recovery Needed
```
recoveryClasses = ceil((targetPercentage/100 * totalClasses - presentClasses) / (1 - targetPercentage/100))
```
Only shown when below target.

---

## Tech Stack

- **OCR:** Tesseract.js (client-side)
- **AI Parsing:** `chatWithAI()` via AI Manager (`packages/backend/src/ai/client.ts`) — routes to Groq/Gemini based on provider config
- **Charts:** Recharts (for trend line graph)
- **State:** Zustand (existing pattern)
- **API:** Existing userAPI pattern
- **Prisma:** New models for attendance records and predictions

---

## Files to Create/Modify

### New Frontend Files
- `apps/web/src/pages/AttendancePage.tsx` — Rewrite with 4 tabs
- `apps/web/src/components/attendance/UploadTab.tsx`
- `apps/web/src/components/attendance/ManualTab.tsx`
- `apps/web/src/components/attendance/PredictionsTab.tsx`
- `apps/web/src/components/attendance/HistoryTab.tsx`
- `apps/web/src/components/attendance/ScenarioTable.tsx`
- `apps/web/src/components/attendance/FrequencyEditor.tsx`

### New Backend Files
- `packages/backend/src/routes/attendance.ts` — New routes for parse/predict/history (uses AI Manager for AI calls)

### Modified Files
- `packages/backend/prisma/schema.prisma` — Add AttendanceRecord, AttendancePrediction models
- `packages/backend/src/index.ts` — Register attendance routes
- `packages/frontend/src/lib/api.ts` — Add attendance API methods

---

## Testing Plan

1. **Upload flow:** Test with various screenshot formats, verify OCR accuracy
2. **Manual entry:** Test adding/deleting rows, bulk fill, save
3. **Predictions:** Verify formulas against manual calculations
4. **Scenario table:** Test all 4 scenarios per subject
5. **Frequency editor:** Test +/- buttons, toggle switches
6. **Dark mode:** Verify all new components work in dark theme
7. **Mobile responsiveness:** Test on small screens

---

## Success Metrics

- Students can upload a screenshot and get accurate extraction
- Predictions match manual spreadsheet calculations
- Page loads in < 2 seconds
- OCR + AI parsing completes in < 5 seconds

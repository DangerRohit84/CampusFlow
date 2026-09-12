# Task 2: Backend — Parse Endpoint (AI Manager)

**Files:**
- Create: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `chatWithAI()` from `../ai/client`
- Produces: `POST /api/attendance/parse` route

## Steps

1. Create `packages/backend/src/routes/attendance.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
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

2. Register routes in `packages/backend/src/index.ts`:
```typescript
import attendanceRoutes from './routes/attendance';
// ...
app.use('/api/attendance', attendanceRoutes);
```

3. Test: `curl -X POST http://localhost:3001/api/attendance/parse -H "Content-Type: application/json" -d "{\"text\": \"Mathematics: 40 total, 35 present, 5 absent\"}"` (with auth token)

4. Commit: `git add packages/backend/src/routes/attendance.ts packages/backend/src/index.ts && git commit -m "feat: add attendance parse endpoint using AI Manager"`

**Working directory:** `D:\Alpha Coders\CampusFlow`

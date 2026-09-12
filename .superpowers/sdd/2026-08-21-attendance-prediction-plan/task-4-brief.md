# Task 4: Backend — History Endpoint

**Files:**
- Modify: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `AttendanceRecord` Prisma model
- Produces: `GET /api/attendance/history` route, `POST /api/attendance/save` route

## Steps

1. Add history and save routes to `packages/backend/src/routes/attendance.ts`:

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

2. Test history: `curl http://localhost:3001/api/attendance/history` (with auth token)
3. Test save: `curl -X POST http://localhost:3001/api/attendance/save -H "Content-Type: application/json" -d "{\"records\": [{\"subject\": \"Math\", \"date\": \"2026-08-20\", \"status\": \"PRESENT\"}], \"source\": \"MANUAL\"}"` (with auth token)

4. Commit: `git add packages/backend/src/routes/attendance.ts && git commit -m "feat: add attendance history and save endpoints"`

**Working directory:** `D:\Alpha Coders\CampusFlow`

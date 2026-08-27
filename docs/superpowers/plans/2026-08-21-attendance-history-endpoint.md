# Attendance History Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GET /history and POST /save routes to the attendance router.

**Architecture:** Extend existing Express router with two new endpoints that interact with Prisma ORM.

**Tech Stack:** Express, TypeScript, Prisma, authenticate middleware.

## Global Constraints
- Do NOT modify existing routes.
- Use existing Prisma singleton from `../config/db`.
- Both routes must use `authenticate` middleware.
- Follow existing code patterns.

---

### Task 1: Add history and save routes to attendance.ts

**Files:**
- Modify: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `authenticate` middleware, `prisma` singleton.
- Produces: `GET /history` and `POST /save` routes.

- [ ] **Step 1: Add import for prisma**

Add `import prisma from '../config/db'` after existing imports.

- [ ] **Step 2: Add GET /history route**

```typescript
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
```

- [ ] **Step 3: Add POST /save route**

```typescript
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

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit` in `packages/backend`.

- [ ] **Step 5: Commit changes**

```bash
git add packages/backend/src/routes/attendance.ts
git commit -m "feat: add attendance history and save endpoints"
```
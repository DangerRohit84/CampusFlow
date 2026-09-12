# Task 2: Backend — Internships Routes

**Files:**
- Create: `packages/backend/src/routes/internships.ts`
- Modify: `packages/backend/src/index.ts`

**Interfaces:**
- Produces: `internshipsRouter` with all internship endpoints
- Consumes: `prisma` from `../config/db`, `auth` from `../middleware/auth`, `ExcelJS` for export

- [ ] **Step 1: Create internships.ts route file**

Create `packages/backend/src/routes/internships.ts` with the following structure:

```typescript
import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import ExcelJS from 'exceljs';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

// GET / - List internships (filtered by eligibility for students)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let internships = await prisma.internship.findMany({
      where: { collegeId: user.collegeId },
      include: { registrations: { where: { userId: req.userId } } },
      orderBy: { createdAt: 'desc' },
    });

    // Filter by eligibility for students
    if (user.role === 'STUDENT' && user.departmentId) {
      internships = internships.filter((i) => {
        if (!i.eligibilityEnabled) return true;
        const depts = JSON.parse(i.targetDepartments) as string[];
        const years = JSON.parse(i.targetYears) as number[];
        const deptMatch = depts.length === 0 || depts.includes(user.departmentId!);
        const currentYear = user.incomingYear
          ? Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
          : 1;
        const yearMatch = years.length === 0 || years.includes(currentYear);
        return deptMatch && yearMatch;
      });
    }

    // Add computed status
    const result = internships.map((i) => ({
      ...i,
      computedStatus: i.status === 'ENDED' || (i.deadline && new Date(i.deadline) < new Date()) ? 'ENDED' : 'ACTIVE',
    }));

    res.json(result);
  } catch (error) {
    console.error('Error listing internships:', error);
    res.status(500).json({ error: 'Failed to list internships' });
  }
});

// GET /:id - Get single internship with registrations
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({
      where: { id: req.params.id },
      include: {
        registrations: { include: { user: { select: { id: true, name: true, email: true, studentId: true } } } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });
    if (!internship) return res.status(404).json({ error: 'Internship not found' });
    res.json(internship);
  } catch (error) {
    console.error('Error getting internship:', error);
    res.status(500).json({ error: 'Failed to get internship' });
  }
});

// POST / - Create internship (teacher only)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      return res.status(403).json({ error: 'Only teachers can create internships' });
    }

    const { title, description, company, role, url, stipend, duration, mode, startDate, deadline, targetDepartments, targetYears, eligibilityEnabled } = req.body;

    const internship = await prisma.internship.create({
      data: {
        title, description, company, role, url,
        stipend: stipend || null,
        duration: duration || null,
        mode: mode || 'REMOTE',
        startDate: startDate || null,
        deadline: deadline || null,
        targetDepartments: JSON.stringify(targetDepartments || []),
        targetYears: JSON.stringify(targetYears || []),
        eligibilityEnabled: eligibilityEnabled || false,
        creatorId: req.userId!,
        collegeId: user.collegeId,
      },
    });

    res.status(201).json(internship);
  } catch (error) {
    console.error('Error creating internship:', error);
    res.status(500).json({ error: 'Failed to create internship' });
  }
});

// DELETE /:id - Delete internship (creator only)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const internship = await prisma.internship.findUnique({ where: { id: req.params.id } });
    if (!internship) return res.status(404).json({ error: 'Internship not found' });
    if (internship.creatorId !== req.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } });
      if (!user || (user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    }
    await prisma.internship.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting internship:', error);
    res.status(500).json({ error: 'Failed to delete internship' });
  }
});

// POST /:id/register - Student registers
router.post('/:id/register', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || user.role !== 'STUDENT') return res.status(403).json({ error: 'Only students can register' });

    const existing = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id, userId: req.userId! } },
    });
    if (existing) return res.status(400).json({ error: 'Already registered' });

    const registration = await prisma.internshipRegistration.create({
      data: { internshipId: req.params.id, userId: req.userId!, status: 'REGISTERED' },
    });

    res.status(201).json(registration);
  } catch (error) {
    console.error('Error registering for internship:', error);
    res.status(500).json({ error: 'Failed to register' });
  }
});

// PUT /:id/report - Student self-reports status
router.put('/:id/report', async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!['SELECTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be SELECTED or REJECTED' });
    }

    const registration = await prisma.internshipRegistration.findUnique({
      where: { internshipId_userId: { internshipId: req.params.id, userId: req.userId! } },
    });
    if (!registration) return res.status(404).json({ error: 'Not registered' });

    const updated = await prisma.internshipRegistration.update({
      where: { id: registration.id },
      data: { status, reportedAt: new Date() },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error reporting status:', error);
    res.status(500).json({ error: 'Failed to report status' });
  }
});

// GET /:id/registrations - Get all registrations (teacher only)
router.get('/:id/registrations', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id },
      include: { user: { select: { id: true, name: true, email: true, studentId: true, departmentId: true } } },
    });

    res.json(registrations);
  } catch (error) {
    console.error('Error getting registrations:', error);
    res.status(500).json({ error: 'Failed to get registrations' });
  }
});

// PUT /:id/registrations/:regId - Update registration status (teacher)
router.put('/:id/registrations/:regId', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { status } = req.body;
    const updated = await prisma.internshipRegistration.update({
      where: { id: req.params.regId },
      data: { status },
    });

    res.json(updated);
  } catch (error) {
    console.error('Error updating registration:', error);
    res.status(500).json({ error: 'Failed to update registration' });
  }
});

// GET /export/:id - Export registrations as Excel
router.get('/export/:id', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user || (user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN')) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const internship = await prisma.internship.findUnique({ where: { id: req.params.id } });
    if (!internship) return res.status(404).json({ error: 'Internship not found' });

    const registrations = await prisma.internshipRegistration.findMany({
      where: { internshipId: req.params.id },
      include: { user: { select: { name: true, email: true, studentId: true } } },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');
    sheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Roll Number', key: 'studentId', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Reported At', key: 'reportedAt', width: 20 },
    ];

    registrations.forEach((r) => {
      sheet.addRow({
        name: r.user.name,
        email: r.user.email,
        studentId: r.user.studentId,
        status: r.status,
        reportedAt: r.reportedAt?.toISOString() || 'N/A',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${internship.title}-registrations.xlsx"`);
    res.send(Buffer.from(buffer as any));
  } catch (error) {
    console.error('Error exporting registrations:', error);
    res.status(500).json({ error: 'Failed to export' });
  }
});

// GET /export-all - Export all internships
router.get('/export-all', async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const internships = await prisma.internship.findMany({
      where: { collegeId: user.collegeId },
      include: { registrations: true },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Internships');
    sheet.columns = [
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Company', key: 'company', width: 20 },
      { header: 'Role', key: 'role', width: 20 },
      { header: 'Mode', key: 'mode', width: 12 },
      { header: 'Stipend', key: 'stipend', width: 15 },
      { header: 'Duration', key: 'duration', width: 15 },
      { header: 'Deadline', key: 'deadline', width: 15 },
      { header: 'Registrations', key: 'regCount', width: 15 },
      { header: 'Selected', key: 'selected', width: 12 },
    ];

    internships.forEach((i) => {
      sheet.addRow({
        title: i.title,
        company: i.company,
        role: i.role,
        mode: i.mode,
        stipend: i.stipend || 'N/A',
        duration: i.duration || 'N/A',
        deadline: i.deadline || 'N/A',
        regCount: i.registrations.length,
        selected: i.registrations.filter((r) => r.status === 'SELECTED').length,
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="internships.xlsx"');
    res.send(Buffer.from(buffer as any));
  } catch (error) {
    console.error('Error exporting internships:', error);
    res.status(500).json({ error: 'Failed to export' });
  }
});

export default router;
```

- [ ] **Step 2: Register route in index.ts**

In `packages/backend/src/index.ts`, add after the hackathons route registration:

```typescript
import internshipsRouter from './routes/internships';
// ... in the route registration section:
app.use('/api/internships', internshipsRouter);
```

- [ ] **Step 3: Test routes with curl/Thunder Client**

Verify: `GET /api/internships` returns empty array, `POST /api/internships` creates (as teacher)

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/routes/internships.ts packages/backend/src/index.ts
git commit -m "feat(backend): add internships CRUD + registration routes"
```

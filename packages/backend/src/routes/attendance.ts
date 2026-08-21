import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth'
import { chatCompletion } from '../ai/client'
import prisma from '../config/db'

const router = Router()

router.post('/parse', authenticate, async (req: Request, res: Response) => {
  try {
    const { text } = req.body
    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'Text is required' })
      return
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
${text}`

    const result = await chatCompletion('attendance', [
      { role: 'user', content: prompt },
    ], { max_tokens: 2048 })

    let subjects
    try {
      const cleaned = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
      subjects = JSON.parse(cleaned)
    } catch {
      res.status(422).json({ error: 'Could not parse AI response', raw: result })
      return
    }

    if (!Array.isArray(subjects)) {
      res.status(422).json({ error: 'AI response is not an array', raw: subjects })
      return
    }

    res.json({ subjects })
  } catch (error) {
    console.error('Parse error:', error)
    res.status(500).json({ error: 'Failed to parse attendance data' })
  }
})

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

export default router

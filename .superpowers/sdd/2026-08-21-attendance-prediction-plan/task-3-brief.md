# Task 3: Backend — Predict Endpoint (Formulas)

**Files:**
- Modify: `packages/backend/src/routes/attendance.ts`

**Interfaces:**
- Consumes: `POST /api/attendance/parse` output format
- Produces: `POST /api/attendance/predict` route

## Steps

1. Add predict route to `packages/backend/src/routes/attendance.ts`:

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

2. Test: `curl -X POST http://localhost:3001/api/attendance/predict -H "Content-Type: application/json" -d "{\"subjects\": [{\"name\": \"Math\", \"total\": 40, \"present\": 35, \"classesPerWeek\": 3, \"weeksRemaining\": 6}], \"targetPercentage\": 75}"` (with auth token)

3. Commit: `git add packages/backend/src/routes/attendance.ts && git commit -m "feat: add attendance predict endpoint with formulas"`

**Working directory:** `D:\Alpha Coders\CampusFlow`

import { Router } from 'express'
import { authenticate, authorize, AuthRequest } from '../middleware/auth'
import * as aiManager from '../services/ai-manager'
import { getUsageSummary, getCollegeQuota, setCollegeQuota } from '../services/aiMetering'
import { recordAudit, buildAuditMetadata, AuditActions } from '../services/auditLog'
import { logger } from '../utils/logger'

const router = Router()

router.use(authenticate)
router.use(authorize(['SUPER_ADMIN']))

// Providers
// topbottom F2: every handler below wraps service throws (Express 4 async
// rejections otherwise hang/crash). 'not found' → 404, built-in guard → 400.
function mapProviderError(res: any, error: unknown, fallback: string): void {
  const msg = String((error as any)?.message || '')
  if (/not found/i.test(msg)) {
    res.status(404).json({ error: msg })
    return
  }
  if (/built-in/i.test(msg)) {
    res.status(400).json({ error: msg })
    return
  }
  logger.debug({ err: msg }, '[ai-manager] provider op failed')
  res.status(500).json({ error: fallback })
}

router.get('/providers', async (req, res) => {
  try {
    const providers = await aiManager.getProviders()
    res.json({ providers })
  } catch (error) {
    mapProviderError(res, error, 'Failed to fetch providers')
  }
})

router.post('/providers', async (req, res) => {
  try {
    const provider = await aiManager.createProvider(req.body)
    res.json({ provider })
  } catch (error) {
    mapProviderError(res, error, 'Failed to create provider')
  }
})

router.put('/providers/:id', async (req, res) => {
  try {
    const provider = await aiManager.updateProvider(req.params.id, req.body)
    res.json({ provider })
  } catch (error) {
    mapProviderError(res, error, 'Failed to update provider')
  }
})

router.delete('/providers/:id', async (req, res) => {
  try {
    await aiManager.deleteProvider(req.params.id)
    res.json({ success: true })
  } catch (error) {
    mapProviderError(res, error, 'Failed to delete provider')
  }
})

router.patch('/providers/:id/toggle', async (req, res) => {
  try {
    const provider = await aiManager.toggleProvider(req.params.id)
    res.json({ provider })
  } catch (error) {
    mapProviderError(res, error, 'Failed to toggle provider')
  }
})

router.post('/providers/:id/test', async (req, res) => {
  try {
    const result = await aiManager.testProvider(req.params.id)
    if (!result.success) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  } catch (error) {
    mapProviderError(res, error, 'Failed to test provider')
  }
})

// Routing
router.get('/routing', async (req, res) => {
  try {
    const routing = await aiManager.getRouting()
    res.json({ routing })
  } catch (error) {
    logger.debug({ err: (error as Error)?.message || error }, '[ai-manager] routing fetch failed')
    res.status(500).json({ error: 'Failed to fetch routing' })
  }
})

router.put('/routing', async (req, res) => {
  try {
    const { feature, providerIds } = req.body
    await aiManager.updateRouting(feature, providerIds)
    const routing = await aiManager.getRouting()
    res.json({ routing })
  } catch (error) {
    logger.debug({ err: (error as Error)?.message || error }, '[ai-manager] routing update failed')
    res.status(500).json({ error: 'Failed to update routing' })
  }
})

// #11 AI metering: per-college usage + cost caps (SUPER_ADMIN only).
// GET /ai-manager/usage?collegeId=&from=&to=&feature= — daily rows (empty
// pre-migration, never 500). from/to are yyyy-mm-dd day buckets.
router.get('/usage', async (req, res) => {
  try {
    const usage = await getUsageSummary({
      collegeId: (req.query.collegeId as string) || null,
      from: (req.query.from as string) || null,
      to: (req.query.to as string) || null,
      feature: (req.query.feature as string) || null,
    })
    const totals = usage.reduce(
      (a, r) => ({ requests: a.requests + (r.requests || 0), tokens: a.tokens + (r.tokens || 0), costCents: a.costCents + (r.costCents || 0) }),
      { requests: 0, tokens: 0, costCents: 0 },
    )
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    res.json({ usage, totals })
  } catch (error) {
    logger.debug({ err: (error as Error)?.message || error }, '[ai-manager] usage failed (non-fatal)')
    res.json({ usage: [], totals: { requests: 0, tokens: 0, costCents: 0 } })
  }
})

// GET /ai-manager/quota/:collegeId — caps with in-memory defaults fallback.
router.get('/quota/:collegeId', async (req, res) => {
  try {
    const quota = await getCollegeQuota(req.params.collegeId as string)
    res.json({ quota })
  } catch {
    res.status(500).json({ error: 'Failed to fetch quota' })
  }
})

// PUT /ai-manager/quota/:collegeId {dailyTokenCap, monthlyTokenCap,
// totalCostCapCents, enabled} — validates bounds, records an audit entry.
router.put('/quota/:collegeId', async (req: AuthRequest, res) => {
  try {
    const collegeId = req.params.collegeId as string
    const result = await setCollegeQuota(collegeId, {
      dailyTokenCap: req.body.dailyTokenCap,
      monthlyTokenCap: req.body.monthlyTokenCap ?? undefined,
      totalCostCapCents: req.body.totalCostCapCents ?? undefined,
      enabled: req.body.enabled,
    })
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    void recordAudit({
      actorId: (req as AuthRequest).userId ?? null,
      actorEmail: null,
      actorRole: 'SUPER_ADMIN',
      action: AuditActions.AI_QUOTA_UPDATE,
      entityType: 'AI_QUOTA',
      entityId: collegeId,
      collegeId,
      metadata: buildAuditMetadata({ ...(req.body as object) }),
    })
    res.json({ quota: result.quota })
  } catch {
    res.status(500).json({ error: 'Failed to save quota' })
  }
})

export default router

import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth'
import * as aiManager from '../services/ai-manager'

const router = Router()

router.use(authenticate)
router.use(authorize(['SUPER_ADMIN']))

// Providers
router.get('/providers', async (req, res) => {
  const providers = await aiManager.getProviders()
  res.json({ providers })
})

router.post('/providers', async (req, res) => {
  const provider = await aiManager.createProvider(req.body)
  res.json({ provider })
})

router.put('/providers/:id', async (req, res) => {
  const provider = await aiManager.updateProvider(req.params.id, req.body)
  res.json({ provider })
})

router.delete('/providers/:id', async (req, res) => {
  await aiManager.deleteProvider(req.params.id)
  res.json({ success: true })
})

router.patch('/providers/:id/toggle', async (req, res) => {
  const provider = await aiManager.toggleProvider(req.params.id)
  res.json({ provider })
})

router.post('/providers/:id/test', async (req, res) => {
  const result = await aiManager.testProvider(req.params.id)
  if (!result.success) {
    res.status(400).json(result)
    return
  }
  res.json(result)
})

// Routing
router.get('/routing', async (req, res) => {
  const routing = await aiManager.getRouting()
  res.json({ routing })
})

router.put('/routing', async (req, res) => {
  const { feature, providerIds } = req.body
  await aiManager.updateRouting(feature, providerIds)
  const routing = await aiManager.getRouting()
  res.json({ routing })
})

export default router

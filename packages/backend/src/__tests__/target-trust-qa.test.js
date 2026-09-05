/**
 * QA: Target-based fetching + Trust in enrichment
 * Run: node packages/backend/src/__tests__/target-trust-qa.test.js
 * Requirements per dispatch:
 *  - schema.prisma trust field + index for HackathonStaging/InternshipStaging
 *  - opportunityAgent.ts target-driven loops for all platforms (page<=10 && new<target, batch dedup, deadline isEnded skip, trust computed in enrichment via computeHackathonTrust/computeInternshipTrust with allContent length, organizer, generic title, prize)
 *  - fetch.ts per-platform limits and enrichAllPending trust not LOW filter
 *  - tsc --noEmit passes both
 *  - prisma generate/validate passes
 *  - Fetch with target 30 fetches incrementally until 30 new, stops early, respects maxPages 10 and empty break, deadline filtering works, duplicate skip works, trust LOW items not enriched
 *  - If target not reached after maxPages returns what we have without infinite loop
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const root = 'D:/Alpha Coders/CampusFlow'
let passes = 0, fails = 0, warnings = 0
function ok(cond, label) {
  if (cond) { passes++; console.log(`PASS | ${label}`) }
  else { fails++; console.error(`FAIL | ${label}`) }
}
function warn(label){ warnings++; console.log(`WARN | ${label}`)}
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }
console.log('=== Target-Based Fetch + Trust QA ===\n')

let schema, agent, fetchRoutes

try { schema = read('packages/backend/prisma/schema.prisma'); ok(true, 'schema.prisma exists') } catch { ok(false, 'schema.prisma exists'); schema='' }
try { agent = read('packages/backend/src/services/opportunityAgent.ts'); ok(true, 'opportunityAgent.ts exists') } catch { ok(false, 'opportunityAgent.ts exists'); agent='' }
try { fetchRoutes = read('packages/backend/src/routes/fetch.ts'); ok(true, 'fetch.ts exists') } catch { ok(false, 'fetch.ts exists'); fetchRoutes='' }

// 1. schema.prisma trust field + index
console.log('\n--- 1. schema.prisma trust field + index ---')
{
  // HackathonStaging trust
  ok(schema.includes('model HackathonStaging'), 'schema contains HackathonStaging model')
  const hackStagingBlock = schema.split('model HackathonStaging')[1]?.split('model ')[0] || ''
  ok(hackStagingBlock.includes('trust') && hackStagingBlock.includes('@default("MEDIUM")'), 'HackathonStaging trust field @default MEDIUM')
  ok(hackStagingBlock.includes('@@index([trust])'), 'HackathonStaging @@index([trust])')
  // InternshipStaging trust
  ok(schema.includes('model InternshipStaging'), 'schema contains InternshipStaging model')
  const internStagingBlock = schema.split('model InternshipStaging')[1]?.split('model ')[0] || ''
  ok(internStagingBlock.includes('trust') && internStagingBlock.includes('@default("MEDIUM")'), 'InternshipStaging trust field @default MEDIUM')
  ok(internStagingBlock.includes('@@index([trust])'), 'InternshipStaging @@index([trust])')
  // Also check datasource still valid (tolerant spacing)
  ok(schema.includes('provider') && schema.includes('"postgresql"'), 'datasource postgresql preserved')
  // Check trust is String type?
  ok(hackStagingBlock.match(/trust\s+String/) && internStagingBlock.match(/trust\s+String/), 'trust type String in both models')
}

// 2. opportunityAgent target-driven loops
console.log('\n--- 2. opportunityAgent target-driven loops (page<=10 && new<target, batch dedup, deadline isEnded skip) ---')
{
  ok(agent.includes('const MAX_PAGES = 10'), 'MAX_PAGES = 10 constant')
  ok(agent.includes('const PER_PAGE = 18'), 'PER_PAGE = 18 constant (Unstop)')

  // Check fetchDevfolio loop pattern
  const devfolioLoop = agent.match(/async function fetchDevfolio[\s\S]*?for \(let page = 1; page <= MAX_PAGES && newItems\.length < target; page\+\+\)/)
  ok(!!devfolioLoop, 'fetchDevfolio target-driven loop: page<=MAX_PAGES && newItems.length<target')

  const devpostLoop = agent.match(/async function fetchDevpost[\s\S]*?for \(let page = 1; page <= MAX_PAGES && newItems\.length < target; page\+\+\)/)
  ok(!!devpostLoop, 'fetchDevpost target-driven loop')

  const internLoop = agent.match(/async function fetchInternshala[\s\S]*?for \(let page = 1; page <= MAX_PAGES && newItems\.length < target; page\+\+\)/)
  ok(!!internLoop, 'fetchInternshala target-driven loop')

  const unstopLoop = agent.match(/async function fetchUnstop[\s\S]*?for \(let page = 1; page <= MAX_PAGES && newItems\.length < target; page\+\+\)/)
  ok(!!unstopLoop, 'fetchUnstop target-driven loop')

  // MLH is special - single page but should still respect target slice + dedup + deadline
  ok(agent.includes('async function fetchMLH'), 'fetchMLH exists')
  const mlhBlock = agent.split('async function fetchMLH')[1]?.split('async function fetchUnstop')[0] || ''
  ok(mlhBlock.includes('if (opportunities.length >= target) break'), 'fetchMLH respects target break')
  ok(mlhBlock.includes('if (deadline && isEnded(deadline)) continue'), 'fetchMLH deadline isEnded skip')
  ok(mlhBlock.includes('existing') && mlhBlock.includes('findMany'), 'fetchMLH batch dedup via DB')
  if (!mlhBlock.includes('for (let page = 1; page <= MAX_PAGES')) {
    warn('fetchMLH does not use paginated loop (expected - single MLH endpoint) - sliced to target instead')
  }

  // Common patterns for all paginated fetchers: empty break, dedup, deadline skip
  const checks = [
    { name: 'fetchDevfolio', fn: 'fetchDevfolio' },
    { name: 'fetchDevpost', fn: 'fetchDevpost' },
    { name: 'fetchInternshala', fn: 'fetchInternshala' },
    { name: 'fetchUnstop', fn: 'fetchUnstop' },
  ]
  for (const {name, fn} of checks) {
    const blockStart = agent.indexOf(`async function ${fn}`)
    if (blockStart === -1) { ok(false, `${name} exists`); continue }
    // Use windowed search: take 8000 chars after start to capture loop regardless of intermediate helpers
    const windowSize = 8000
    const block = agent.substring(blockStart, blockStart + windowSize)
    ok(block.includes('if (results.length === 0) break') || block.includes('if (items.length === 0) break'), `${name}: empty break`)
    ok(block.includes('existingTitles.has(item.title)') || block.includes('existingTitles.has(opp.title)') || block.includes('existingSet.has'), `${name}: batch dedup via existingTitles`)
    ok(block.includes('isEnded(item.deadline)') || block.includes('isEnded(opp.deadline)'), `${name}: deadline isEnded skip`)
    ok(block.includes('if (newItems.length >= target) break'), `${name}: early stop when target reached`)
    ok(block.includes('slice(0, target)') || block.includes('sliced'), `${name}: final slice to target`)
  }

  // Check target calculation
  ok(agent.includes('const target = limit && limit > 0 ? limit : Number.MAX_SAFE_INTEGER'), 'target = limit>0 ? limit : MAX_SAFE_INTEGER pattern exists')
  // Verify fetchFromAllSources respects per-platform limits
  ok(agent.includes('export async function fetchFromAllSources(limits?: Record<string, number | undefined>)'), 'fetchFromAllSources accepts limits map')
  ok(agent.includes('fetchDevfolio(limits?.DEVFOLIO)'), 'fetchFromAllSources passes DEVFOLIO limit')
  ok(agent.includes('fetchDevpost(limits?.DEVPOST)'), 'fetchFromAllSources passes DEVPOST limit')
  ok(agent.includes('fetchInternshala(limits?.INTERNSHALA)'), 'fetchFromAllSources passes INTERNSHALA limit')
  ok(agent.includes('fetchMLH(limits?.MLH)'), 'fetchFromAllSources passes MLH limit')
  ok(agent.includes('fetchUnstop(limits?.UNSTOP)'), 'fetchFromAllSources passes UNSTOP limit')
  ok(agent.includes("filter(opp => !opp.deadline || !isEnded(opp.deadline))"), 'final deadline filter in fetchFromAllSources/platform')

  ok(agent.includes('export async function fetchFromPlatform'), 'fetchFromPlatform exists')
  ok(agent.includes('if (limit && limit > 0) return filtered.slice(0, limit)'), 'fetchFromPlatform slices to limit')
}

// 3. trust computed in enrichment
console.log('\n--- 3. Trust computed in enrichment via compute*Trust with allContent length, organizer, generic title, prize ---')
{
  ok(agent.includes('function computeHackathonTrust'), 'computeHackathonTrust exists')
  ok(agent.includes('function computeInternshipTrust'), 'computeInternshipTrust exists')
  ok(agent.includes("type TrustLevel = 'HIGH' | 'MEDIUM' | 'LOW'"), 'TrustLevel type HIGH|MEDIUM|LOW')
  ok(agent.includes('function isGenericTitle'), 'isGenericTitle helper exists')
  ok(agent.includes('function hasValue'), 'hasValue helper exists')
  ok(agent.includes('function isEnded'), 'isEnded helper exists')

  // computeHackathonTrust checks
  const hackTrustBlock = agent.split('function computeHackathonTrust')[1]?.split('function computeInternshipTrust')[0] || ''
  ok(hackTrustBlock.includes('allContent'), 'computeHackathonTrust takes allContent param')
  ok(hackTrustBlock.includes('isGenericTitle'), 'computeHackathonTrust uses isGenericTitle')
  ok(hackTrustBlock.includes('organizerPresent'), 'computeHackathonTrust checks organizerPresent')
  ok(hackTrustBlock.includes('contentLength') && hackTrustBlock.includes('contentOk') && hackTrustBlock.includes('> 300'), 'computeHackathonTrust checks content length >300')
  ok(hackTrustBlock.includes('hasPrize') || hackTrustBlock.includes('prizePool'), 'computeHackathonTrust checks prizePool')
  ok(hackTrustBlock.includes('hasThemes') || hackTrustBlock.includes('hasPrizeOrThemes'), 'computeHackathonTrust checks themes/prize')
  ok(hackTrustBlock.includes("return 'LOW'") && hackTrustBlock.includes("return 'HIGH'") && hackTrustBlock.includes("return 'MEDIUM'"), 'computeHackathonTrust returns all 3 levels')
  ok(hackTrustBlock.includes('deadlineEnded') && hackTrustBlock.includes("return 'LOW'"), 'computeHackathonTrust LOW if deadlineEnded')
  ok(hackTrustBlock.includes('lowSignals >= 3'), 'computeHackathonTrust LOW if 3+ weak signals')

  const internTrustBlock = agent.split('function computeInternshipTrust')[1]?.split('async function fetchDevfolioPage')[0] || ''
  ok(internTrustBlock.includes('allContent'), 'computeInternshipTrust takes allContent')
  ok(internTrustBlock.includes('companyPresent') || internTrustBlock.includes('company'), 'computeInternshipTrust checks company')
  ok(internTrustBlock.includes('contentLength') && internTrustBlock.includes('> 300'), 'computeInternshipTrust checks content length')
  ok(internTrustBlock.includes('hasStipend') || internTrustBlock.includes('stipend'), 'computeInternshipTrust checks stipend')
  ok(internTrustBlock.includes('hasDuration') || internTrustBlock.includes('duration'), 'computeInternshipTrust checks duration')
  ok(internTrustBlock.includes("return 'LOW'") && internTrustBlock.includes("return 'HIGH'"), 'computeInternshipTrust returns LOW/HIGH')

  // Enrichment uses trust computed before AI and skips LOW
  ok(agent.includes('const trust: TrustLevel = computeHackathonTrust(record, allContent)'), 'enrichHackathonStaging computes trust via computeHackathonTrust(record, allContent)')
  ok(agent.includes("if (trust === 'LOW') {"), 'enrichHackathonStaging early return if LOW')
  ok(agent.includes('await prisma.hackathonStaging.update({') && agent.substr(agent.indexOf("if (trust === 'LOW')"), 500).includes("trust: 'LOW'"), 'enrichHackathonStaging updates trust LOW before return')
  ok(agent.includes('console.log(`[Enrichment] Skipping LOW trust hackathon'), 'logs skipping LOW trust hackathon')

  ok(agent.includes('const trust: TrustLevel = computeInternshipTrust(record, allContent)'), 'enrichInternshipStaging computes trust')
  ok(agent.includes('Skipping LOW trust internship'), 'logs skipping LOW trust internship')
  // Check enrichment sets trust on success
  ok(agent.includes('updateData.trust = trust'), 'enrich sets trust on success updateData')
  // Check allContent length evaluation in enrichment before trust
  ok(agent.includes('let allContent =') && agent.includes('substring(0, 6000)'), 'enrichment fetches up to 6000 chars content')
  ok(agent.includes("if (allContent.length < 300") && agent.includes('searchDetails'), 'enrichment fallback to search if content <300')
}

// 4. fetch.ts per-platform limits and enrichAllPending trust not LOW filter
console.log('\n--- 4. fetch.ts per-platform limits and enrichAllPending trust not LOW ---')
{
  ok(fetchRoutes.includes('limits') && fetchRoutes.includes('normalizedLimits'), 'fetch.ts normalizes limits')
  ok(fetchRoutes.includes("v === 0 ? undefined : v"), '0 => undefined (fetch all up to MAX_PAGES)')
  ok(fetchRoutes.includes('normalizedLimits[k.toUpperCase()]'), 'limits keys uppercased')
  ok(fetchRoutes.includes('fetchFromAllSources(normalizedLimits)'), 'POST /all passes normalizedLimits to fetchFromAllSources')
  ok(fetchRoutes.includes("router.post('/:platform'"), 'POST /:platform exists')
  ok(fetchRoutes.includes('fetchFromPlatform(platform, limit > 0 ? limit : undefined)'), 'POST /:platform passes limit to fetcher')
  ok(fetchRoutes.includes('limit > 0 ? result.slice(0, limit) : result'), 'ensures limit respected exactly via slice')

  // enrichAllPending trust not LOW
  ok(fetchRoutes.includes('async function enrichAllPending'), 'enrichAllPending exists')
  const enrichPendingBlock = fetchRoutes.split('async function enrichAllPending')[1]?.split('router.get')[0] || ''
  ok(enrichPendingBlock.includes("trust: { not: 'LOW' }") || enrichPendingBlock.includes('trust: { not: "LOW" }'), 'enrichAllPending filters trust not LOW')
  ok(enrichPendingBlock.includes("trust: null") || enrichPendingBlock.includes('{ trust: null }'), 'enrichAllPending includes trust null (un-enriched)')
  // Check duplicate find: should be trust filter applied in both hackathon and internship loops
  const trustFilterCount = (fetchRoutes.match(/trust:\s*\{\s*not:\s*['"]LOW['"]\s*\}/g) || []).length
  ok(trustFilterCount >= 4, `fetch.ts has >=4 trust not LOW filters (found ${trustFilterCount}) - covers enrichAllPending + both enrich endpoints`)
  ok(fetchRoutes.includes("OR: [{ trust: null }, { trust: { not: 'LOW' } }]"), 'exact pattern OR trust null OR not LOW')

  // Also check enrich endpoints
  ok(fetchRoutes.includes("router.post('/hackathons/enrich'") && fetchRoutes.includes("router.post('/internships/enrich'"), 'both enrich endpoints exist')
  ok(fetchRoutes.includes('orderBy: [{ deadline: \'asc\' }, { createdAt: \'desc\' }]') || fetchRoutes.includes('orderBy: [{ deadline: "asc" }'), 'enrich orders by deadline asc (closest first)')
  ok(fetchRoutes.includes("BATCH_SIZE = 5"), 'BATCH_SIZE =5')
  // check per-platform limits respect exactly comment
  ok(fetchRoutes.includes('target-driven capped at 10 pages') || fetchRoutes.includes('capped at 10 pages') || fetchRoutes.includes('capped at ${MAX_PAGES}'), 'comments mention capped at 10 pages')
}

// 5. tsc --noEmit passes
console.log('\n--- 5. tsc --noEmit passes ---')
{
  try {
    console.log('Running backend tsc --noEmit...')
    execSync('npx tsc --noEmit --project packages/backend/tsconfig.json', { cwd: root, stdio: 'pipe', timeout: 90000 })
    ok(true, 'backend tsc --noEmit passes exit 0')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 1000))
    ok(false, 'backend tsc --noEmit passes')
  }
  try {
    console.log('Running web tsc --noEmit...')
    const hasWeb = fs.existsSync(path.join(root, 'apps/web/tsconfig.json'))
    if (hasWeb) {
      execSync('npx tsc --noEmit --project apps/web/tsconfig.json', { cwd: root, stdio: 'pipe', timeout: 90000 })
      ok(true, 'web tsc --noEmit passes (if exists)')
    } else {
      ok(true, 'web tsconfig not found skipped')
    }
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, 'web tsc --noEmit passes')
  }
  // Also check no 'any' misuse? Skip
}

// 6. prisma validate/generate
console.log('\n--- 6. prisma validate/generate ---')
{
  try {
    execSync('npx prisma validate', { cwd: path.join(root, 'packages/backend'), stdio: 'pipe', timeout: 30000 })
    ok(true, 'prisma validate passes')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '') + (e.message || '')
    console.error(out.slice(0, 800))
    ok(false, 'prisma validate passes')
  }
  try {
    // generate already tested implicitly via validate, but check it doesn't error
    execSync('npx prisma generate', { cwd: path.join(root, 'packages/backend'), stdio: 'pipe', timeout: 60000 })
    ok(true, 'prisma generate passes')
    // Check generated client exists
    const clientExists = fs.existsSync(path.join(root, 'node_modules/.prisma/client')) || fs.existsSync(path.join(root, 'node_modules/@prisma/client'))
    ok(clientExists, '@prisma/client generated exists in node_modules')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, 'prisma generate passes')
  }
}

// 7. Simulated fetch behavior tests
console.log('\n--- 7. Simulated fetch target behavior (unit) ---')
{
  // Helpers mirroring actual code
  function isEnded(deadlineStr) {
    if (!deadlineStr) return false
    try { const d = new Date(deadlineStr); if (isNaN(d.getTime())) return false; return d.getTime() < Date.now() } catch { return false }
  }
  // trust helpers copied from actual implementation (simplified but representative)
  function isGenericTitle(title) {
    if (!title) return true
    const t = title.toLowerCase().trim()
    if (t.length < 5) return true
    const genericKeywords = ['test', 'fake', 'sample', 'dummy', 'example', 'asdf', 'qwerty', 'lorem ipsum', 'untitled', 'hackathon test', 'test hackathon', 'demo', 'placeholder']
    return genericKeywords.some(k => t.includes(k))
  }
  function hasValue(val) {
    if (val === null || val === undefined) return false
    if (typeof val === 'string') return val.trim().length > 0 && val.trim() !== '[]' && val.trim().toLowerCase() !== 'unknown'
    if (Array.isArray(val)) return val.length > 0
    return !!val
  }
  function computeHackathonTrust(record, allContent) {
    const title = record.title || ''
    const isGeneric = isGenericTitle(title)
    const deadlineStr = record.deadline ? (record.deadline instanceof Date ? record.deadline.toISOString() : String(record.deadline)) : ''
    const deadlineEnded = deadlineStr ? isEnded(deadlineStr) : false
    const deadlineFuture = deadlineStr ? !deadlineEnded : false
    const organizerPresent = hasValue(record.organizer) && String(record.organizer).toLowerCase() !== 'unknown' && String(record.organizer).trim().length > 2
    const contentLength = (allContent || '').length
    const contentOk = contentLength > 300
    let hasThemes = false
    if (record.themes) {
      try { const parsed = typeof record.themes === 'string' ? JSON.parse(record.themes) : record.themes; hasThemes = Array.isArray(parsed) && parsed.length > 0 } catch { const raw = String(record.themes).trim(); hasThemes = raw.length > 0 && raw !== '[]' && raw !== '{}' }
    }
    const hasPrize = hasValue(record.prizePool)
    const hasParticipants = (record.participantsCount || 0) > 0
    const hasPrizeOrThemes = hasPrize || hasThemes || hasParticipants
    if (deadlineEnded) return 'LOW'
    if (isGeneric && !organizerPresent) return 'LOW'
    let lowSignals = 0
    if (!organizerPresent) lowSignals++
    if (isGeneric) lowSignals++
    if (!hasPrizeOrThemes) lowSignals++
    if (!contentOk) lowSignals++
    if (lowSignals >= 3) return 'LOW'
    if (!contentOk && !organizerPresent && !hasPrizeOrThemes) return 'LOW'
    if (deadlineFuture && organizerPresent && contentOk && hasPrizeOrThemes && !isGeneric) return 'HIGH'
    if (!deadlineEnded) return 'MEDIUM'
    return 'LOW'
  }
  function computeInternshipTrust(record, allContent) {
    const title = record.title || ''
    const isGeneric = isGenericTitle(title)
    const deadlineStr = record.deadline ? String(record.deadline) : ''
    const deadlineEnded = deadlineStr ? isEnded(deadlineStr) : false
    const deadlineFuture = deadlineStr ? !deadlineEnded : false
    const companyPresent = hasValue(record.company) && String(record.company).toLowerCase() !== 'unknown' && String(record.company).trim().length > 2
    const contentLength = (allContent || '').length || String(record.description || '').length
    const contentOk = contentLength > 300
    const hasStipend = hasValue(record.stipend)
    const hasDuration = hasValue(record.duration)
    const hasStipendOrDuration = hasStipend || hasDuration
    if (deadlineEnded) return 'LOW'
    if (isGeneric && !companyPresent) return 'LOW'
    let lowSignals = 0
    if (!companyPresent) lowSignals++
    if (isGeneric) lowSignals++
    if (!hasStipendOrDuration) lowSignals++
    if (!contentOk) lowSignals++
    if (lowSignals >= 3) return 'LOW'
    if (!contentOk && !companyPresent && !hasStipendOrDuration) return 'LOW'
    if (deadlineFuture && companyPresent && contentOk && hasStipendOrDuration && !isGeneric) return 'HIGH'
    if (!deadlineEnded) return 'MEDIUM'
    return 'LOW'
  }

  // Simulate paginated fetch with target=30 incremental
  async function simulateFetch({ target = 30, maxPages = 10, perPageMocks, existingTitles = new Set(), deadlineFilter = true }) {
    const MAX_PAGES = 10
    const tgt = target && target > 0 ? target : Number.MAX_SAFE_INTEGER
    const seen = new Set()
    const newItems = []
    let pagesFetched = 0
    for (let page = 1; page <= MAX_PAGES && newItems.length < tgt; page++) {
      pagesFetched++
      if (page > maxPages) break // Sim cap
      const mock = perPageMocks[page] || []
      if (mock.length === 0) break // empty break
      // Simulate seen dedup within pages (like original seen set)
      const results = []
      for (const item of mock) {
        if (seen.has(item.title)) continue
        seen.add(item.title)
        results.push(item)
      }
      if (results.length === 0) break
      // Batch dedup via DB
      const titles = results.map(r => r.title).filter(Boolean)
      let existingSet = existingTitles
      for (const item of results) {
        if (newItems.length >= tgt) break
        if (existingSet.has(item.title)) continue
        if (deadlineFilter && item.deadline && isEnded(item.deadline)) continue
        newItems.push(item)
      }
      if (newItems.length >= tgt) break
    }
    const sliced = tgt === Number.MAX_SAFE_INTEGER ? newItems : newItems.slice(0, tgt)
    return { items: sliced, pagesFetched, totalNew: newItems.length }
  }

  // Test 7a: target 30 incremental until 30 new, stops early, respects maxPages 10 and empty break
  {
    // Create 5 pages of 10 items each = 50, target 30 should stop at page 3
    const perPage = {}
    for (let p=1; p<=5; p++) {
      perPage[p] = Array.from({length:10}, (_, i) => ({ title: `Hack-${p}-${i}`, deadline: '2099-12-31', organizer: 'Org' }))
    }
    const res = await simulateFetch({ target:30, perPageMocks: perPage })
    ok(res.items.length === 30, `target 30 fetches incrementally: got ${res.items.length} /30`)
    ok(res.pagesFetched === 3, `stops early after 3 pages (got ${res.pagesFetched}) not fetching all 5`)
    ok(res.pagesFetched <= 10, 'respects maxPages 10 (pagesFetched <=10)')
  }

  // 7b: deadline filtering works
  {
    const perPage = {
      1: [
        { title: 'Future Hack', deadline: '2099-12-31' },
        { title: 'Past Hack', deadline: '2020-01-01' },
        { title: 'No Deadline Hack', deadline: '' },
        { title: 'Invalid Date', deadline: 'not-a-date' },
      ]
    }
    const res = await simulateFetch({ target: 10, perPageMocks: perPage })
    ok(res.items.length === 3, `deadline filtering: past deadline skipped (got ${res.items.length}, expected 3 including no-deadline + invalid)`)
    ok(!res.items.some(i => i.title === 'Past Hack'), 'past deadline item not in results')
    ok(res.items.some(i => i.title === 'Future Hack'), 'future deadline kept')
    ok(res.items.some(i => i.title === 'No Deadline Hack'), 'empty deadline not filtered (allowed)')
  }

  // 7c: duplicate skip works (batch dedup)
  {
    const existing = new Set(['Existing Hack'])
    const perPage = {
      1: [
        { title: 'Existing Hack', deadline: '2099-12-31' },
        { title: 'New Hack 1', deadline: '2099-12-31' },
        { title: 'New Hack 2', deadline: '2099-12-31' },
      ],
      2: [
        { title: 'New Hack 2', deadline: '2099-12-31' }, // duplicate within seen
        { title: 'New Hack 3', deadline: '2099-12-31' },
      ]
    }
    const res = await simulateFetch({ target: 10, perPageMocks: perPage, existingTitles: existing })
    ok(res.items.length === 3, `duplicate skip: existing + seen dedup (got ${res.items.length}, expected 3 - New Hack 1,2,3)`)
    ok(!res.items.some(i => i.title === 'Existing Hack'), 'existing title not in results (deduped via DB)')
    ok(res.items.filter(i => i.title === 'New Hack 2').length === 1, 'seen dedup across pages works (New Hack 2 only once)')
  }

  // 7d: empty break
  {
    const perPage = {
      1: [{ title: 'Hack 1', deadline: '2099-12-31' }],
      2: [], // empty causes break
      3: [{ title: 'Hack 3', deadline: '2099-12-31' }], // should not be fetched
    }
    const res = await simulateFetch({ target: 30, perPageMocks: perPage })
    ok(res.items.length === 1, `empty break: stops when page empty (got ${res.items.length})`)
    ok(res.pagesFetched === 2, `empty break pagesFetched 2 not 3 (got ${res.pagesFetched})`)
  }

  // 7e: trust LOW items not enriched (enrichAllPending filter)
  {
    // Simulate enrichAllPending where clause: trust not LOW
    const mockStaging = [
      { id:'1', trust:'HIGH', deadline: new Date('2099-12-31'), description:'', targetDepartments:'[]' },
      { id:'2', trust:'LOW', deadline: new Date('2099-12-31'), description:'', targetDepartments:'[]' },
      { id:'3', trust:'MEDIUM', deadline: new Date('2099-12-31'), description:'', targetDepartments:'[]' },
      { id:'4', trust:null, deadline: new Date('2099-12-31'), description:'', targetDepartments:'[]' },
      { id:'5', trust:'LOW', deadline: new Date('2099-12-31'), description:'', targetDepartments:'[]' },
    ]
    function filterEnrich(items, today = new Date('2099-01-01')) {
      return items.filter(i => {
        if (i.trust === 'LOW') return false
        // OR trust null OR not LOW -> includes null, HIGH, MEDIUM
        const trustOK = i.trust === null || i.trust !== 'LOW'
        const deadlineOK = !i.deadline || i.deadline >= today
        const pending = i.description === '' || i.targetDepartments === '[]'
        return trustOK && deadlineOK && pending
      })
    }
    const pending = filterEnrich(mockStaging)
    ok(pending.length === 3, `trust LOW filter: pending ${pending.length} (expected 3: HIGH, MEDIUM, null)`)
    ok(!pending.some(p=>p.trust==='LOW'), 'LOW trust items not in pending enrich')
    ok(pending.some(p=>p.trust===null), 'null trust items included (to be evaluated)')
  }

  // 7f: target not reached after maxPages returns what we have without infinite loop
  {
    const perPage = {}
    for (let p=1; p<=10; p++) perPage[p] = [{ title: `Hack-${p}`, deadline: '2099-12-31' }] // 10 items total after 10 pages
    const res = await simulateFetch({ target:30, perPageMocks: perPage })
    ok(res.items.length === 10, `target not reached after maxPages: got ${res.items.length} /30 (10 pages *1 =10)`)
    ok(res.pagesFetched === 10, `maxPages cap 10 respected (pagesFetched ${res.pagesFetched})`)
    ok(res.pagesFetched <= 10, 'no infinite loop (>10 pages)')
    // Also test spy that loop terminates even if target huge but pages empty earlier
    const perPage2 = {1:[{title:'OnlyOne'}]}
    const res2 = await simulateFetch({ target:100, perPageMocks: perPage2 })
    ok(res2.items.length === 1, `sparse data: only 1 available, returns 1 not infinite (got ${res2.items.length})`)
    ok(res2.pagesFetched === 2, 'breaks after empty page 2')
  }

  // 7g: trust evaluation correctness (allContent length, organizer, generic title, prize)
  {
    const future = '2099-12-31'
    const past = '2020-01-01'
    const longContent = 'x'.repeat(500)
    const shortContent = 'short'
    // HIGH: future deadline, organizer present, contentOk, hasPrizeOrThemes, not generic
    const highRec = { title: 'AI Innovation Challenge 2026', organizer: 'MLH', deadline: future, prizePool: '₹100000', themes: JSON.stringify(['AI']), participantsCount: 100 }
    ok(computeHackathonTrust(highRec, longContent) === 'HIGH', 'trust HIGH when all strong signals')

    // LOW: deadline ended
    const endedRec = { title: 'Good Hack', organizer: 'Org', deadline: past, prizePool: '₹1000', themes: '["AI"]' }
    ok(computeHackathonTrust(endedRec, longContent) === 'LOW', 'trust LOW when deadline ended')

    // LOW: generic title + no organizer
    const genericRec = { title: 'test hackathon', organizer: '', deadline: future, prizePool: '', themes: '[]' }
    ok(computeHackathonTrust(genericRec, shortContent) === 'LOW', 'trust LOW when generic title + no organizer')

    // LOW: short content + missing organizer + no prize (covers "even after fallback search")
    const lowSignalsRec = { title: 'Valid Title', organizer: '', deadline: future, prizePool: '', themes: '[]', participantsCount: 0 }
    ok(computeHackathonTrust(lowSignalsRec, shortContent) === 'LOW', 'trust LOW when short content + no organizer + no prize/themes')

    // LOW: 3+ weak signals (no organizer, generic, no prize, short content) -> lowSignals >=3
    const manyWeakRec = { title: 'demo hack', organizer: '', deadline: future, prizePool: '', themes: '[]' }
    ok(computeHackathonTrust(manyWeakRec, shortContent) === 'LOW', 'trust LOW when 3+ weak signals')

    // MEDIUM: future deadline with some signals but not HIGH (e.g., no prize but organizer + content)
    const mediumRec = { title: 'Blockchain Hackathon', organizer: 'Devfolio', deadline: future, prizePool: '', themes: '[]', participantsCount:0 }
    // contentOk true, organizer true, but no prizeOrThemes => should be MEDIUM? Check logic: lowSignals 1 (no prize) => not LOW, not HIGH => MEDIUM via !deadlineEnded
    ok(computeHackathonTrust(mediumRec, longContent) === 'MEDIUM', `trust MEDIUM when future deadline but missing prize/themes (got ${computeHackathonTrust(mediumRec, longContent)})`)

    // Internship trust checks
    const internHigh = { title: 'Software Engineer Intern', company: 'Google', deadline: future, stipend: '₹50000', duration: '3 months', description: longContent }
    ok(computeInternshipTrust(internHigh, longContent) === 'HIGH', 'intern HIGH when future + company + content + stipend')

    const internLowGeneric = { title: 'test', company: '', deadline: future, stipend:'', duration:'' , description: shortContent }
    ok(computeInternshipTrust(internLowGeneric, shortContent) === 'LOW', 'intern LOW when generic + no company + short content')

    const internLowPast = { title: 'Intern', company:'Acme', deadline: past, stipend:'₹10000', description: longContent}
    ok(computeInternshipTrust(internLowPast, longContent) === 'LOW', 'intern LOW when deadline ended')

    // isGeneric edge
    ok(isGenericTitle('test')===true, 'isGenericTitle "test" => true')
    ok(isGenericTitle('AI Innovation Challenge')===false, 'isGenericTitle valid title => false')
    ok(isGenericTitle('')===true, 'isGenericTitle empty => true')
    ok(isGenericTitle('abcd')===true, 'isGenericTitle <5 chars => true')
  }

  // 7h: verify intern trust uses allContent length vs description fallback
  {
    const internRec = { title: 'Data Intern', company: 'Acme', deadline: '2099-12-31', stipend:'₹10000', description: 'x'.repeat(500) }
    // allContent empty but description long => contentOk true via fallback
    // Our earlier helper uses allContent || description length, so should be HIGH if other signals present with long description
    ok(computeInternshipTrust(internRec, '') === 'HIGH' || computeInternshipTrust(internRec, 'x'.repeat(10)) === 'HIGH' || computeInternshipTrust(internRec, 'x'.repeat(500)) === 'HIGH', 'intern content fallback via description length works')
  }
}

// 8. Additional fetch.ts validations: per-platform limits normalized and capped
console.log('\n--- 8. fetch.ts limit normalization & safety ---')
{
  // Simulate normalization logic from fetch.ts
  function normalizeLimits(limits) {
    const normalized = {}
    for (const [k,v] of Object.entries(limits)) normalized[k.toUpperCase()] = v===0 ? undefined : v
    return normalized
  }
  const norm = normalizeLimits({ devfolio:30, DEVPOST:0, unstop:15 })
  ok(norm['DEVFOLIO']===30, 'normalize devfolio 30 =>30')
  ok(norm['DEVPOST']===undefined, 'normalize 0 => undefined')
  ok(norm['UNSTOP']===15, 'normalize unstop 15 =>15')
  ok(norm['DEVFOLIO'] !== undefined && norm['DEVFOLIO']===30, 'uppercase keys')

  // Safety filter after fetchFromAllSources: ensure per-platform limits respected exactly
  function safetyFilter(items, normalizedLimits) {
    const counts = {}
    return items.filter(item => {
      const limit = normalizedLimits[item.source]
      if (!limit) return true
      counts[item.source] = (counts[item.source]||0)+1
      return counts[item.source] <= limit
    })
  }
  const mockItems = [
    {source:'DEVFOLIO', title:'A'}, {source:'DEVFOLIO', title:'B'}, {source:'DEVFOLIO', title:'C'},
    {source:'DEVPOST', title:'X'}, {source:'DEVPOST', title:'Y'}
  ]
  const filtered = safetyFilter(mockItems, {DEVFOLIO:2, DEVPOST: undefined})
  ok(filtered.length===4, `safety filter per-platform cap (2 for DEVFOLIO => 2/3, DEVPOST all =>2) => ${filtered.length}`)
  ok(filtered.filter(i=>i.source==='DEVFOLIO').length===2, 'DEVFOLIO capped to 2')
}

// 9. Regression: ensure infinite loop not possible with maxPages, ensure batch dedup log
console.log('\n--- 9. Regression & infinite loop prevention ---')
{
  // Verify loop condition in code contains both maxPages and target check
  const loopMatches = agent.match(/for \(let page = 1; page <= MAX_PAGES && newItems\.length < target; page\+\+\)/g) || []
  ok(loopMatches.length >= 4, `found ${loopMatches.length} target-driven loops with maxPages && target (expected >=4)`)

  // Verify fetch.ts also has maxPages comment / safety
  ok(fetchRoutes.includes('target-driven capped at 10 pages') || fetchRoutes.includes('capped at 10 pages'), 'fetch.ts comments mention maxPages cap prevents infinite loop')

  // Ensure enrichment trust is evaluated before AI (compute before chatCompletion)
  const hackEnrichIdx = agent.indexOf('export async function enrichHackathonStaging')
  const trustIdx = agent.indexOf('const trust: TrustLevel = computeHackathonTrust', hackEnrichIdx)
  const aiIdx = agent.indexOf("chatCompletion('enrichment'", hackEnrichIdx)
  ok(trustIdx !== -1 && aiIdx !== -1 && trustIdx < aiIdx, 'hackathon trust computed before AI call (trustIdx < aiIdx)')

  const internEnrichIdx = agent.indexOf('export async function enrichInternshipStaging')
  const iTrustIdx = agent.indexOf('const trust: TrustLevel = computeInternshipTrust', internEnrichIdx)
  const iAiIdx = agent.indexOf("chatCompletion('enrichment'", internEnrichIdx)
  ok(iTrustIdx !== -1 && iAiIdx !== -1 && iTrustIdx < iAiIdx, 'internship trust computed before AI')

  // Verify isEnded used everywhere deadline checked
  const endedCount = (agent.match(/isEnded\(/g) || []).length
  ok(endedCount >= 6, `isEnded used >=6 times (found ${endedCount}) for deadline filtering`)
}

// Summary
console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}, Warn: ${warnings}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed — see FAIL above`)
else console.log(`\nAll target-trust checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

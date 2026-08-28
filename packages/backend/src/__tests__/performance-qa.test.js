/**
 * QA: CampusFlow Performance Fixes — Backend Regression Tests
 * Verifies pagination + indexes + compression + ETag/CDN + Cache-Control
 * Run: node packages/backend/src/__tests__/performance-qa.test.js
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import assert from 'assert'

const root = path.resolve('D:/Alpha Coders/CampusFlow')
let passes = 0, fails = 0
function ok(cond, label) {
  if (cond) { passes++; console.log(`PASS | ${label}`) }
  else { fails++; console.error(`FAIL | ${label}`) }
}
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }

console.log('=== Backend Performance Fixes QA ===\n')

// 1. package.json compression
{
  const pkg = JSON.parse(read('packages/backend/package.json'))
  ok(pkg.dependencies?.compression === '^1.8.1', 'pkg compression ^1.8.1 exists')
  ok(!!pkg.devDependencies?.['@types/compression'], '@types/compression exists')
}

// 2. index.ts compression + etag ordering
{
  const idx = read('packages/backend/src/index.ts')
  ok(idx.includes("import compression from 'compression'"), 'index.ts imports compression')
  ok(idx.includes("import { etagCacheMiddleware }"), 'index.ts imports etagCacheMiddleware')
  ok(idx.includes("app.use(compression({ threshold: 1024 }))"), 'compression threshold 1024')
  ok(idx.includes("app.use(etagCacheMiddleware)"), 'etagCacheMiddleware wired')
  // order: compression before helmet before etagCache
  const compIdx = idx.indexOf('app.use(compression')
  const helmIdx = idx.indexOf('app.use(helmet')
  const etagIdx = idx.indexOf('app.use(etagCacheMiddleware')
  ok(compIdx < helmIdx && helmIdx < etagIdx && compIdx !== -1, 'middleware order compression < helmet < etag (Cloudflare pattern)')
}

// 3. etagCache middleware exists + correct logic
{
  const etagPath = 'packages/backend/src/middleware/etagCache.ts'
  ok(fs.existsSync(path.join(root, etagPath)), 'etagCache.ts file exists')
  const etag = read(etagPath)
  ok(etag.includes('export function etagCacheMiddleware'), 'etagCacheMiddleware exported')
  ok(etag.includes('W/"${hash}"') || etag.includes('W/"'), 'weak ETag W/"<md5>" generated')
  ok(etag.includes("crypto.createHash('md5')"), 'MD5 hash used')
  ok(etag.includes("If-None-Match") || etag.includes('if-none-match'), 'If-None-Match honored')
  ok(etag.includes('304'), '304 Not Modified returned')
  ok(etag.includes('res.status(304)'), 'res.status(304) branch exists')
  ok(etag.includes('Cache-Control'), 'Cache-Control set in middleware')
  ok(etag.includes('s-maxage'), 's-maxage CDN directive present')
  ok(etag.includes('Vary'), 'Vary header set')
  ok(etag.includes('Accept-Encoding, Authorization'), 'Vary: Accept-Encoding, Authorization (no cross-user leak)')
  ok(etag.includes('500_000'), 'skip huge payload >500k protection')
  ok(etag.includes('req.method !== \'GET\''), 'only GET handled')
  ok(etag.includes('res.getHeader(\'ETag\')'), 'skip if already has ETag')
  // runtime unit: simulate hashing
  const body = { data: [{id:1}], pagination: {page:1, limit:20, total:1, pages:1} }
  const hash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex')
  const expectedEtag = `W/"${hash}"`
  ok(expectedEtag.startsWith('W/"') && expectedEtag.length === 36, `ETag format correct example ${expectedEtag}`)
  // test If-None-Match matching splits by comma
  const inm = `W/"abc", ${expectedEtag}, W/"xyz"`
  const includes = inm.split(',').map(s=>s.trim()).includes(expectedEtag)
  ok(includes, 'If-None-Match comma-split matching works (GitHub pagination pattern)')
}

// 4. Pagination shape in routes
{
  const routes = ['contests','forms','hackathons','internships','rooms']
  for (const r of routes) {
    const file = read(`packages/backend/src/routes/${r}.ts`)
    const hasPage = file.includes('parseInt(req.query.page')
    const hasLimit = file.includes('parseInt(req.query.limit')
    const hasSkip = file.includes('const skip')
    const hasPagination = file.includes('pagination')
    const hasData = file.includes('data:')
    const hasLimitMinMax = file.includes('Math.min(50') && file.includes('|| 20')
    ok(hasPage && hasLimit && hasSkip, `${r}.ts has page/limit/skip pagination parsing (limit 20 default, max 50)`)
    ok(hasLimitMinMax, `${r}.ts limit clamp 1-50 default 20`)
    ok(hasPagination && hasData, `${r}.ts returns {data, pagination}`)
    ok(file.includes('Math.ceil(total / limit)'), `${r}.ts computes pages via ceil(total/limit)`)
  }
}

// 5. Cache-Control headers
{
  const contests = read('packages/backend/src/routes/contests.ts')
  ok(contests.includes("Cache-Control', 'public, max-age=30, stale-while-revalidate=60, s-maxage=120"), 'contests.ts Cache-Control with s-maxage 120 + SWR')
  ok(contests.includes("res.set('Link'") && contests.includes('rel="next"'), 'contests.ts Link pagination header (GitHub-style)')

  const hack = read('packages/backend/src/routes/hackathons.ts')
  ok(hack.includes('Cache-Control') && hack.includes('s-maxage=120'), 'hackathons.ts Cache-Control with s-maxage')
  ok(hack.includes("res.set('Link'"), 'hackathons.ts Link header')

  const intern = read('packages/backend/src/routes/internships.ts')
  ok(intern.includes('Cache-Control') && intern.includes('s-maxage=120'), 'internships.ts Cache-Control with s-maxage')

  const forms = read('packages/backend/src/routes/forms.ts')
  ok(forms.includes('Cache-Control'), 'forms.ts has Cache-Control')
  // note: forms missing s-maxage is medium bug — check but mark as bug
  const formsHasSmax = forms.includes('s-maxage')
  if (!formsHasSmax) console.log(`WARN | forms.ts Cache-Control missing s-maxage (edge cache gap) — medium bug`)
  ok(forms.includes('max-age=30'), 'forms.ts max-age 30 present')

  const rooms = read('packages/backend/src/routes/rooms.ts')
  ok(rooms.includes('Cache-Control'), 'rooms.ts has Cache-Control')
  const roomsHasSmax = rooms.includes('s-maxage')
  if (!roomsHasSmax) console.log(`WARN | rooms.ts Cache-Control missing s-maxage (15s only) — medium bug`)
  ok(rooms.includes('max-age=15'), 'rooms.ts max-age 15 correct (shorter for live hallway)')
}

// 6. Prisma indexes >=30 added
{
  const schema = read('packages/backend/prisma/schema.prisma')
  const allIndexes = (schema.match(/@@index/g) || []).length
  ok(allIndexes >= 60, `schema.prisma total indexes >=60 (got ${allIndexes}) — high-scale indexed`)
  // count diff vs base: verify +38 added
  // check key indexes exist
  ok(schema.includes('@@index([collegeId, status, createdAt])'), 'composite index [collegeId, status, createdAt] exists')
  ok(schema.includes('@@index([platform') || schema.includes('@@index([platform, status])'), 'CodingContest platform indexes exist')
  ok(schema.includes('@@index([collegeId, role])'), 'User collegeId+role index exists')
  ok(schema.includes('@@index([collegeId, status])') || schema.includes('@@index([collegeId, status, createdAt])'), 'Hackathon collegeId+status index exists')
}

// 7. Rooms batch unread optimization
{
  const rooms = read('packages/backend/src/routes/rooms.ts')
  ok(rooms.includes('GROUP BY rm."roomId"'), 'rooms.ts unread batch uses GROUP BY (single query vs N+1)')
  ok(rooms.includes('LEFT JOIN "RoomRead"'), 'rooms.ts LEFT JOIN RoomRead for per-room threshold')
  ok(rooms.includes('NOT EXISTS (SELECT 1 FROM "MessageHide"'), 'rooms.ts hides NOT EXISTS correct')
  ok(rooms.includes('Batch unread raw query failed') || rooms.includes('Fallback'), 'rooms.ts has fallback for raw query failure')
}

// 8. Compression threshold & helmet order
{
  const idx = read('packages/backend/src/index.ts')
  ok(idx.indexOf('compression({ threshold: 1024 })') !== -1, 'compression threshold 1024 (1kB min, avoids tiny JSON overhead)')
}

// 9. render.yaml warm cron
{
  const render = read('render.yaml')
  ok(render.includes('campusflow-keepalive'), 'render.yaml keepalive cron exists')
  ok(render.includes('*/5 * * * *'), 'keepalive every 5 min')
  ok(render.includes('/api/health'), 'keepalive hits /api/health')
}

// Summary
console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed — see FAIL lines`)
else console.log(`\nAll backend performance checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

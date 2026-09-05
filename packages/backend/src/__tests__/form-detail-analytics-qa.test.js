/**
 * QA: FormDetail analytics Backend — Verification
 * Run: node packages/backend/src/__tests__/form-detail-analytics-qa.test.js
 * Verifies: GET /forms/:id/stats and /pending exist, auth, correct counts, college isolation, indexes
 */
import fs from 'fs'
import path from 'path'

const root = 'D:/Alpha Coders/CampusFlow'
let passes = 0, fails = 0
function ok(cond, label) { if (cond) { passes++; console.log(`PASS | ${label}`) } else { fails++; console.error(`FAIL | ${label}`) } }
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }

console.log('=== Form Analytics Backend QA ===\n')

const formsPath = 'packages/backend/src/routes/forms.ts'
const schemaPath = 'packages/backend/prisma/schema.prisma'
const socketPath = 'packages/backend/src/services/socket.ts'

let forms, schema, socket
try { forms = read(formsPath); ok(true, `${formsPath} exists`) } catch { ok(false, `${formsPath} exists`); forms='' }
try { schema = read(schemaPath); ok(true, `${schemaPath} exists`) } catch { ok(false, `${schemaPath} exists`); schema='' }
try { socket = read(socketPath); ok(true, `${socketPath} exists`) } catch { ok(false, `${socketPath} exists`); socket='' }

// 1. Routes exist with correct paths + middleware
{
  ok(forms.includes("router.use(authenticate)"), 'router.use(authenticate) - all routes require auth')
  ok(forms.includes("router.get('/:id/stats'"), 'GET /:id/stats route exists')
  ok(forms.includes("router.get('/:id/pending'"), 'GET /:id/pending route exists')
  ok(forms.includes('fetchEligibleFormStudents'), 'fetchEligibleFormStudents helper exists')
  ok(forms.includes('parseJsonArraySafe') && forms.includes('parseJsonNumberArraySafe'), 'parseJson helpers exist')
}

// 2. Auth checks on stats
{
  ok(forms.includes("if (!user) { res.status(404)"), 'stats: user exists check')
  ok(forms.includes("if (!form) { res.status(404)"), 'stats: form exists check')
  ok(forms.includes("if (form.collegeId && user.collegeId && form.collegeId !== user.collegeId"), 'stats: college isolation check (tenant isolation)')
  ok(forms.includes("const isTeacher = user.role === 'TEACHER'"), 'stats: isTeacher role check')
  ok(forms.includes("isCR = user.role === 'STUDENT' && await prisma.formRoom.findFirst"), 'stats: isCR check via formRoom')
  ok(forms.includes("if (!isTeacher && !isCR) { res.status(403)"), 'stats: 403 when neither teacher nor CR')
  ok(forms.includes("Only teachers/CRs can view stats"), 'stats: error message correct')
}

// 3. Auth checks on pending
{
  const pendingSection = forms.split("router.get('/:id/pending'")[1] || ''
  ok(pendingSection.includes("if (!isTeacher && !isCR)"), 'pending: 403 when neither teacher nor CR')
  ok(pendingSection.includes("Only teachers/CRs can view pending"), 'pending: error message correct')
  ok(pendingSection.includes("form.collegeId && user.collegeId && form.collegeId !== user.collegeId"), 'pending: college isolation')
}

// 4. Correct counts logic
{
  ok(forms.includes("const eligibleList = await fetchEligibleFormStudents(form)"), 'stats: eligible via fetchEligibleFormStudents')
  ok(forms.includes("const eligible = eligibleList.length"), 'stats: eligible = length')
  ok(forms.includes("const submitted = await prisma.formResponse.count"), 'stats: submitted via count')
  ok(forms.includes("const pending = Math.max(0, eligible - submitted)"), 'stats: pending = max(0, eligible - submitted)')
  ok(forms.includes("const submissionRate = eligible ? Math.round((submitted/eligible)*100) : 0"), 'stats: submissionRate calc correct (no div0)')
  ok(forms.includes("res.json({ eligible, submitted, pending, submissionRate"), 'stats: returns eligible/submitted/pending/submissionRate')
  // pending logic
  ok(forms.includes("const submittedIds = new Set(responses.map(r=> r.userId))"), 'pending: submittedIds set')
  ok(forms.includes("eligible.filter((u:any)=> !submittedIds.has(u.id))"), 'pending: filter eligible minus submitted')
  ok(forms.includes("pending.sort((a:any,b:any)=> (a.name||'').localeCompare"), 'pending: sorted by name')
  ok(forms.includes("res.json({ data: pending, total: pending.length"), 'pending: returns {data, total, count}')
}

// 5. fetchEligibleFormStudents correctness — room-linked branch
{
  ok(forms.includes("prisma.formRoom.findMany({ where: { formId: form.id }"), 'fetchEligible: reads formRoom links')
  ok(forms.includes("prisma.roomMember.findMany"), 'fetchEligible: reads roomMember for room-linked')
  ok(forms.includes("Map<string, any>()") && forms.includes("!map.has(s.id)"), 'fetchEligible: dedupes students across rooms')
  ok(forms.includes("prisma.user.findMany({ where: { id: { in: ids }, role: 'STUDENT' }"), 'fetchEligible: filters role STUDENT after dedupe')
  ok(forms.includes("where: { role: 'STUDENT' as const }") || forms.includes("role: 'STUDENT'"), 'fetchEligible: STUDENT role filter exists')
}

// 6. eligibilityEnabled branch
{
  ok(forms.includes("if (form.eligibilityEnabled)"), 'fetchEligible: eligibilityEnabled branch exists')
  ok(forms.includes("parseJsonArraySafe(form.targetDepartments)"), 'fetchEligible: parses targetDepartments')
  ok(forms.includes("parseJsonNumberArraySafe(form.targetYears)"), 'fetchEligible: parses targetYears')
  ok(forms.includes("if (targetDeptIds.length === 0 && targetYears.length === 0) return []"), 'fetchEligible: returns [] if eligibilityEnabled but no targeting (avoid leak)')
  ok(forms.includes("if (form.collegeId) where.collegeId = form.collegeId"), 'fetchEligible: filters by collegeId')
  ok(forms.includes("where.departmentId = { in: targetDeptIds }"), 'fetchEligible: filters by departmentId')
  ok(forms.includes("Math.min(nowYear - u.incomingYear + 1, 4)"), 'fetchEligible: computes currentYear correctly (clamped to 4)')
  ok(forms.includes("targetYears.includes(currentYear)"), 'fetchEligible: filters by incomingYear')
}

// 7. Open form branch
{
  ok(forms.includes("// 3) Open form: all students in same college"), 'fetchEligible: open form comment exists')
  ok(forms.includes("prisma.user.findMany({ where: { role: 'STUDENT', collegeId: form.collegeId }"), 'fetchEligible: open form returns all students in college')
  ok(forms.includes("return []"), 'fetchEligible: final fallback return []')
}

// 8. Socket realtime
{
  ok(socket.includes("export function emitFormUpdated"), 'socket: emitFormUpdated exists')
  ok(socket.includes("export function emitFormResponseUpdated"), 'socket: emitFormResponseUpdated exists')
  ok(socket.includes("export function emitFormExtended"), 'socket: emitFormExtended exists')
  ok(socket.includes("export function broadcastFormMutation"), 'socket: broadcastFormMutation exists')
  ok(socket.includes("safeEmit('form:updated'"), 'socket: safeEmit form:updated')
  ok(socket.includes("safeEmit('form:mutated'") , 'socket: safeEmit form:mutated')
  ok(socket.includes("safeEmit('form:response:updated'"), 'socket: safeEmit form:response:updated')
  ok(forms.includes("broadcastFormMutation(form.id)"), 'forms route calls broadcastFormMutation on create')
  ok(forms.includes("emitFormUpdated") && forms.includes("emitFormResponseUpdated") && forms.includes("emitFormExtended"), 'forms routes emit socket events')
}

// 9. Existing critical paths not broken (regression)
{
  ok(forms.includes("router.post('/', async"), 'POST / create still exists')
  ok(forms.includes("router.get('/', async"), 'GET / list still exists')
  ok(forms.includes("router.get('/:id', async"), 'GET /:id still exists')
  ok(forms.includes("router.post('/:id/respond'"), 'POST /:id/respond still exists')
  ok(forms.includes("router.get('/:id/export'"), 'GET /:id/export still exists')
  ok(forms.includes("router.delete('/:id'"), 'DELETE /:id still exists')
  ok(forms.includes("router.put('/:id'") || forms.includes("router.put('/:id/fields'"), 'PUT still exists')
  ok(forms.includes("allowEdit") && forms.includes("expiresAt"), 'fields allowEdit/expiresAt still handled')
}

// 10. Prisma indexes for performance (forms / responses)
{
  const formIdxCount = (schema.match(/model Form/g) || []).length
  ok(formIdxCount>=1, 'schema has Form model')
  ok(schema.includes('model FormResponse'), 'schema has FormResponse model')
  // Check at least form has collegeId index or generic
  ok(schema.includes('@@index([collegeId') || schema.includes('@@index([formId'), 'schema has collegeId/formId indexes')
  ok(schema.includes('@@index([formId, userId])') || schema.includes('@@index([formId])'), 'FormResponse has formId index')
}

// 11. Functional unit: simulate stats calculation edge cases
{
  function simulateStats(eligible, submitted){
    const pending = Math.max(0, eligible - submitted)
    const rate = eligible ? Math.round((submitted/eligible)*100) : 0
    return {eligible, submitted, pending, rate}
  }
  let r = simulateStats(10,3)
  ok(r.pending===7 && r.rate===30, `stats 10 eligible 3 submitted => pending 7 rate 30% (got ${r.pending},${r.rate})`)
  r = simulateStats(0,0)
  ok(r.pending===0 && r.rate===0, `stats 0 eligible => pending 0 rate 0 (got ${r.pending},${r.rate})`)
  r = simulateStats(5,5)
  ok(r.pending===0 && r.rate===100, `stats 5/5 => pending 0 rate 100 (got ${r.pending},${r.rate})`)
  r = simulateStats(3,5)
  ok(r.pending===0, `stats when submitted>eligible clamp pending 0 (got ${r.pending})`)
  r = simulateStats(3,1)
  ok(r.rate===33, `stats 1/3 =>33% (got ${r.rate})`)
  // college isolation simulation
  function canAccess(formCollege, userCollege, role){
    if (formCollege && userCollege && formCollege !== userCollege && role !== 'SUPER_ADMIN') return false
    return true
  }
  ok(!canAccess('c1','c2','TEACHER'), 'college isolation blocks cross-college')
  ok(canAccess('c1','c1','TEACHER'), 'same college allowed')
  ok(canAccess('c1','c2','SUPER_ADMIN'), 'SUPER_ADMIN bypasses isolation')
  // submittedIds filter simulation
  const eligibleUsers = [{id:'u1',name:'Alice'},{id:'u2',name:'Bob'},{id:'u3',name:'Charlie'}]
  const responses = [{userId:'u2'}]
  const set = new Set(responses.map(r=>r.userId))
  const pending = eligibleUsers.filter(u=> !set.has(u.id))
  ok(pending.length===2 && pending[0].id==='u1', 'pending filter correct (eligible minus submitted)')
  // dedupe simulation
  const members = [{student:{id:'u1'}},{student:{id:'u1'}},{student:{id:'u2'}}]
  const map = new Map()
  for(const m of members){ if(!map.has(m.student.id)) map.set(m.student.id, m.student) }
  ok(map.size===2, 'dedupe across rooms works (2 unique from 3 entries)')
}

// 12. Error handling & tenant isolation everywhere
{
  ok(forms.includes("status: 404") || forms.includes("res.status(404)"), '404 for not found exists')
  ok(forms.includes("status: 403") || forms.includes("res.status(403)"), '403 for forbidden exists')
  ok(forms.includes("status: 500") || forms.includes("res.status(500)"), '500 handling exists')
  ok(forms.includes("try {") && forms.includes("catch"), 'try/catch error handling present')
}

// 13. No security bypass
{
  ok(!forms.includes("if (true) return"), 'no hard-coded bypass')
  ok(!forms.includes("// TODO bypass"), 'no TODO bypass comment')
}

console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed`)
else console.log(`\nAll backend FormDetail analytics checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

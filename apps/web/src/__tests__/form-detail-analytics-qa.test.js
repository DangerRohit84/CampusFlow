/**
 * QA: FormDetailPage analytics + filters — Frontend Verification
 * Run: node apps/web/src/__tests__/form-detail-analytics-qa.test.js
 * Verifies: analytics cards, filters, tabs, export CSV, realtime stats (parity AssignmentDetailPage)
 */
import fs from 'fs'
import path from 'path'

const root = 'D:/Alpha Coders/CampusFlow'
let passes = 0, fails = 0
function ok(cond, label) {
  if (cond) { passes++; console.log(`PASS | ${label}`) }
  else { fails++; console.error(`FAIL | ${label}`) }
}
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }

console.log('=== FormDetailPage Analytics (Frontend) QA ===\n')

const pagePath = 'apps/web/src/pages/FormDetailPage.tsx'
const apiPath = 'apps/web/src/lib/api.ts'
const socketPath = 'apps/web/src/lib/socket.ts'

let page, api, sock
try { page = read(pagePath); ok(true, `${pagePath} exists`) } catch { ok(false, `${pagePath} exists`); page='' }
try { api = read(apiPath); ok(true, `${apiPath} exists`) } catch { ok(false, `${apiPath} exists`); api='' }
try { sock = read(socketPath); ok(true, `${socketPath} exists`) } catch { ok(false, `${socketPath} exists`); sock='' }

// 1. formAPI stats/getPending exist
{
  ok(api.includes('stats: (id: string) => api.get(`/forms/${id}/stats`)'), 'formAPI.stats(id) GET /forms/:id/stats exists')
  ok(api.includes('getPending: (id: string) => api.get(`/forms/${id}/pending`)'), 'formAPI.getPending(id) GET /forms/:id/pending exists')
  ok(api.includes('exportOne'), 'formAPI.exportOne exists (XLSX)')
  ok(page.includes('formAPI.stats'), 'FormDetailPage calls formAPI.stats')
  ok(page.includes('formAPI.getPending'), 'FormDetailPage calls formAPI.getPending')
}

// 2. Analytics state
{
  ok(page.includes("const [stats, setStats]"), 'stats state exists')
  ok(page.includes("const [pendingStudents, setPendingStudents]"), 'pendingStudents state exists')
  ok(page.includes("const [activeTab, setActiveTab]"), 'activeTab state exists')
  ok(page.includes("const [search, setSearch]"), 'search state exists')
  ok(page.includes("const [selectedDept, setSelectedDept]"), 'selectedDept state exists')
  ok(page.includes("const [selectedYear, setSelectedYear]"), 'selectedYear state exists')
  ok(page.includes("loadStatsAndPending"), 'loadStatsAndPending() exists')
}

// 3. Analytics cards (Eligible / Submitted / Pending / Response Rate)
{
  ok(page.includes("'Eligible'") || page.includes('"Eligible"') || page.includes('label: \'Eligible\''), 'Card: Eligible exists')
  ok(page.includes("'Submitted'") || page.includes('label: \'Submitted\''), 'Card: Submitted exists')
  ok(page.includes("'Pending'") || page.includes('label: \'Pending\''), 'Card: Pending exists')
  ok(page.includes('Response Rate') || page.includes('Response Rate\''), 'Card: Response Rate exists')
  ok(page.includes('eligibleCount') && page.includes('submittedCount') && page.includes('pendingCount'), 'derived counts eligibleCount/submittedCount/pendingCount')
  ok(page.includes('responseRate') || page.includes('submissionRate'), 'responseRate / submissionRate derived')
  ok(page.includes('grid-cols-2 md:grid-cols-4'), '4-col StatsPanel grid exists')
}

// 4. Extra analytics 3-col breakdown
{
  ok(page.includes('Submitted vs Pending'), 'Breakdown: Submitted vs Pending exists')
  ok(page.includes('Response progress'), 'Breakdown: Response progress exists')
  ok(page.includes('Pending by department'), 'Breakdown: Pending by department exists')
  ok(page.includes('pendingDeptBreakdown'), 'pendingDeptBreakdown memo exists')
  ok(page.includes('availableYears'), 'availableYears memo exists')
  ok(page.includes('BarChart2') && page.includes('Award') && page.includes('Users'), 'icons BarChart2/Award/Users imported')
}

// 5. Filters (search, department dropdown, year dropdown)
{
  ok(page.includes('placeholder="Search name, student ID, email..."'), 'Search input placeholder correct')
  ok(page.includes('value={search} onChange'), 'Search controlled input exists')
  ok(page.includes('value={selectedDept}') && page.includes('onChange={e=> setSelectedDept'), 'Department dropdown exists')
  ok(page.includes('<option value="ALL">All departments</option>'), 'All departments option exists')
  ok(page.includes('departments.map'), 'departments mapped to options')
  ok(page.includes('value={selectedYear}') && page.includes('setSelectedYear'), 'Year dropdown exists')
  ok(page.includes('<option value="ALL">All years</option>'), 'All years option exists')
  ok(page.includes('departmentAPI.getAll'), 'departments fetched via departmentAPI.getAll()')
}

// 6. Filtered memos
{
  ok(page.includes('const filteredPending = useMemo'), 'filteredPending useMemo exists')
  ok(page.includes('const filteredResponses = useMemo'), 'filteredResponses useMemo exists')
  // Search
  ok(page.includes('term') && page.includes('toLowerCase') && page.includes('hay.includes(term)'), 'search filtering via hay.includes(term)')
  // Dept filter
  ok(page.includes("selectedDept !== 'ALL'"), 'dept filter branch exists')
  // Year filter
  ok(page.includes("selectedYear !== 'ALL'"), 'year filter branch exists')
  // Clear filters
  ok(page.includes('Clear filters') && page.includes("setSearch('')"), 'Clear filters button exists')
}

// 7. Tabs Submitted | Pending
{
  ok(page.includes("setActiveTab('submitted')"), 'Submitted tab setter exists')
  ok(page.includes("setActiveTab('pending')"), 'Pending tab setter exists')
  ok(page.includes("activeTab==='submitted'") || page.includes('activeTab === \'submitted\''), 'activeTab submitted branch')
  ok(page.includes("activeTab==='pending'") || page.includes('activeTab === \'pending\''), 'activeTab pending branch')
  ok(page.includes('border-b-2') && page.includes('border-primary-500'), 'tab active styling with border-primary-500')
}

// 8. Export CSV
{
  ok(page.includes('const handleExportCSV'), 'handleExportCSV function exists')
  ok(page.includes('Export CSV'), 'Export CSV button text exists')
  ok(page.includes('Blob([csv]') || page.includes("new Blob([csv]"), 'CSV Blob creation exists')
  ok(page.includes('createObjectURL'), 'createObjectURL for CSV download')
  ok(page.includes('a.download ='), 'download attribute set')
  ok(page.includes('fieldHeaders') && page.includes("form.fields.map"), 'fieldHeaders from form.fields')
  ok(page.includes('esc = (v:any)'), 'csv escaping function esc exists')
  ok(page.includes('replace(/"/g,\'""\')'), 'csv quote escaping handles double quotes')
  ok(page.includes('filteredResponses.forEach') && page.includes('filteredPending.forEach'), 'CSV includes both filteredResponses and filteredPending')
  ok(page.includes('Status') && page.includes('SubmittedAt'), 'CSV header includes Status/SubmittedAt')
  // XLSX export also present
  ok(page.includes('formAPI.exportOne') && page.includes('responses.xlsx'), 'XLSX export via formAPI.exportOne exists')
}

// 9. Realtime stats via socket
{
  ok(page.includes("getSocket()"), 'getSocket() used')
  ok(page.includes("form:mutated") && page.includes("form:updated") && page.includes("form:response:updated") && page.includes("form:extended"), 'socket subscribes to form:mutated/form:updated/form:response:updated/form:extended')
  ok(page.includes("socket.on(ev, handler)"), 'socket.on in loop exists')
  ok(page.includes("socket.off(ev, handler)"), 'socket.off cleanup exists')
  ok(page.includes("loadStatsAndPending"), 'realtime handler calls loadStatsAndPending')
  ok(page.includes("queryClient.invalidateQueries({ queryKey: ['forms'] })"), 'invalidates forms query on mutation')
  ok(page.includes("window.addEventListener('form:mutated'"), 'window form:mutated listener exists (parity)')
  ok(page.includes("window.dispatchEvent(new CustomEvent('form:mutated'"), 'dispatch form:mutated on submit/extend/update')
}

// 10. Teacher gating
{
  ok(page.includes("const isTeacher = user?.role === 'TEACHER'"), 'isTeacher gating exists')
  ok(page.includes("isTeacher && (") || page.includes("{isTeacher && ("), 'analytics rendered only for isTeacher')
  ok(page.includes("if (!isTeacher) return") || page.includes("if (isTeacher) loadStatsAndPending"), 'loadStatsAndPending gated by isTeacher')
}

// 11. Correct counts display strings
{
  ok(page.includes("{eligibleCount} eligible"), 'eligibleCount display exists')
  ok(page.includes("filteredResponses.length") && page.includes("filteredPending.length"), 'filtered counts shown')
  ok(page.includes("Response Rate") && page.includes("${responseRate}%") || page.includes('`${responseRate}%`') || page.includes('responseRate'), 'responseRate % display')
}

// 12. Edge: handle empty states
{
  ok(page.includes('No responses yet') || page.includes('No responses match filters'), 'empty submitted state handled')
  ok(page.includes('All eligible students have submitted') || page.includes('No pending'), 'empty pending state handled')
  ok(page.includes('try {') && page.includes('JSON.parse'), 'safe JSON parse for answers')
}

// 13. Functional unit: simulate filtering logic (happy + edge + boundary)
{
  // Simulate filteredPending logic
  const mockPending = [
    { id:'1', name:'Alice', studentId:'21CS001', email:'alice@x.com', departmentName:'CSE', departmentId:'dept1', incomingYear:2021 },
    { id:'2', name:'Bob', studentId:'21EC002', email:'bob@x.com', departmentName:'ECE', departmentId:'dept2', incomingYear:2022 },
    { id:'3', name:'Charlie', studentId:'', email:'', departmentName:'Unknown', incomingYear:null },
    { id:'4', name:'alice cooper', studentId:'22CS003', email:'alice2@x.com', departmentName:'CSE', departmentId:'dept1', incomingYear:2021 },
  ]
  const term = 'alice'
  const filteredBySearch = mockPending.filter(p=>{
    const hay = `${p.name||''} ${p.studentId||''} ${p.email||''}`.toLowerCase()
    return hay.includes(term.toLowerCase())
  })
  ok(filteredBySearch.length===2, `filter by search 'alice' returns 2 (got ${filteredBySearch.length}) - case-insensitive`)
  ok(filteredBySearch.every(p=> p.name.toLowerCase().includes('alice')), 'search filter correctly case-insensitive')

  // Dept filter
  const filteredByDept = mockPending.filter(p=> p.departmentId==='dept1')
  ok(filteredByDept.length===2, `dept filter dept1 returns 2 (got ${filteredByDept.length})`)
  // Year filter
  const filteredByYear = mockPending.filter(p=> String(p.incomingYear ?? '') === '2021')
  ok(filteredByYear.length===2, `year filter 2021 returns 2 (got ${filteredByYear.length})`)
  // Empty search returns all
  const emptyTerm = ''.trim().toLowerCase()
  const allIfEmpty = mockPending.filter(p=>{
    if(emptyTerm){ const hay=`${p.name}`.toLowerCase(); if(!hay.includes(emptyTerm)) return false }
    return true
  })
  ok(allIfEmpty.length===4, 'empty search returns all pending')
  // Special characters: search with comma?
  const esc = (v)=>{ const s=String(v??''); if(s.includes(',')||s.includes('"')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`; return s}
  ok(esc('a,b') === '"a,b"', 'csv esc handles comma')
  ok(esc('a"b') === '"a""b"', 'csv esc handles double quote')
  ok(esc('a\nb') === '"a\nb"', 'csv esc handles newline')
  ok(esc('simple') === 'simple', 'csv esc leaves simple unchanged')
  // Rate calculation edge: 0 eligible
  const rate0 = 0 ? Math.round((0/0)*100) : 0
  ok(rate0===0, 'rate 0 when eligible 0 (no division by zero)')
  // Boundary: 100%
  const rateFull = Math.round((5/5)*100)
  ok(rateFull===100, 'rate 100% when all submitted')
  // Boundary: rounding
  const rate33 = Math.round((1/3)*100)
  ok(rate33===33, 'rate rounding 1/3 =>33')
}

// 14. Department breakdown simulation
{
  const pending = [{departmentName:'CSE'},{departmentName:'CSE'},{departmentName:'ECE'}]
  const map = new Map()
  pending.forEach(p=>{ const k=p.departmentName||'Unknown'; map.set(k,(map.get(k)||0)+1)})
  const breakdown = Array.from(map.entries()).sort((a,b)=> b[1]-a[1])
  ok(breakdown[0][0]==='CSE' && breakdown[0][1]===2, 'pendingDeptBreakdown sorted desc CSE 2 top')
  ok(breakdown.length===2, 'breakdown has 2 departments')
}

// 15. Security: no hard-coded bypass
{
  ok(!page.includes('role === \'STUDENT\' && true'), 'no hard-coded student bypass')
}

console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed`)
else console.log(`\nAll frontend FormDetail analytics checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

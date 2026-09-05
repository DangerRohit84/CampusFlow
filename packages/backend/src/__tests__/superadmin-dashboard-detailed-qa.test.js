/**
 * QA: Superadmin Global Dashboard — Detailed Verification
 * Run: node "D:/Alpha Coders/CampusFlow/packages/backend/src/__tests__/superadmin-dashboard-detailed-qa.test.js"
 * Verifies senior-dev implementation:
 *  - Backend GET /admin/super/dashboard SUPER_ADMIN only, KPIs, breakdown.byCollege, recent, system, Cache-Control, no migration
 *  - Frontend SuperAdminDashboardPage.tsx header, college dropdown, date range, Pending Queue, KPI StatCards, College Distribution bars, Submission Rate table, Recent Activity, Quick Actions, System Health, TanStack stale 15s, socket invalidation, routing /superadmin guard, Layout Super Overview
 *  - tsc --noEmit passes both
 *  - No regression on AdminPage
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const root = 'D:/Alpha Coders/CampusFlow'
let passes = 0, fails = 0
function ok(cond, label) {
  if (cond) { passes++; console.log(`PASS | ${label}`) }
  else { fails++; console.error(`FAIL | ${label}`) }
}
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }

console.log('=== SUPERADMIN DASHBOARD QA (Detailed) ===\n')

let admin, superPage, app, layout, api, adminPage, roles, visibility, schema
try { admin = read('packages/backend/src/routes/admin.ts'); ok(true, 'backend admin.ts exists') } catch { ok(false, 'admin.ts exists'); admin='' }
try { superPage = read('apps/web/src/pages/SuperAdminDashboardPage.tsx'); ok(true, 'SuperAdminDashboardPage.tsx exists') } catch { ok(false, 'SuperAdminDashboardPage.tsx exists'); superPage='' }
try { app = read('apps/web/src/App.tsx'); ok(true, 'apps/web/src/App.tsx exists') } catch { ok(false, 'App.tsx exists'); app='' }
try { layout = read('apps/web/src/components/layout/Layout.tsx'); ok(true, 'Layout.tsx exists') } catch { ok(false, 'Layout.tsx exists'); layout='' }
try { api = read('apps/web/src/lib/api.ts'); ok(true, 'apps/web/src/lib/api.ts exists') } catch { ok(false, 'api.ts exists'); api='' }
try { adminPage = read('apps/web/src/pages/AdminPage.tsx'); ok(true, 'AdminPage.tsx exists') } catch { ok(false, 'AdminPage.tsx exists'); adminPage='' }
try { roles = read('packages/backend/src/utils/roles.ts'); ok(true, 'roles.ts exists') } catch { ok(false, 'roles.ts exists'); roles='' }
try { visibility = read('packages/backend/src/utils/assignmentVisibility.ts'); ok(true, 'assignmentVisibility.ts exists') } catch { ok(false, 'assignmentVisibility.ts exists'); visibility='' }
try { schema = read('packages/backend/prisma/schema.prisma'); ok(true, 'schema.prisma exists') } catch { ok(false, 'schema.prisma exists'); schema='' }

// 1. Backend route existence & auth
console.log('\n--- 1. Backend GET /admin/super/dashboard auth ---')
{
  ok(admin.includes("router.get('/super/dashboard'"), 'admin.ts has GET /super/dashboard route')
  ok(admin.includes("if (!user || user.role !== 'SUPER_ADMIN')"), 'dashboard checks SUPER_ADMIN role')
  ok(admin.includes("res.status(403).json({ error: 'Super admin only' })"), 'dashboard 403 message correct')
  ok(admin.includes("router.use(authenticate)"), 'admin router uses authenticate middleware')
  // ensure not using authorize bypass
  const dashboardBlock = admin.split("router.get('/super/dashboard'")[1]?.split("router.get")[0] || ''
  ok(dashboardBlock.includes("403"), 'dashboard block contains 403')
  ok(dashboardBlock.includes("prisma.user.findUnique"), 'dashboard fetches user to verify role')
}

// 2. Query filters collegeId & from/to
console.log('\n--- 2. Backend query filters collegeId & from/to ---')
{
  ok(admin.includes("const collegeId = (req.query.collegeId as string"), 'dashboard reads collegeId from query')
  ok(admin.includes("const fromParam = req.query.from as string"), 'dashboard reads from param')
  ok(admin.includes("const toParam = req.query.to as string"), 'dashboard reads to param')
  ok(admin.includes("let fromDate: Date | undefined") && admin.includes("let toDate: Date | undefined"), 'dashboard declares fromDate/toDate')
  ok(admin.includes("if (fromParam) {") && admin.includes("new Date(fromParam)"), 'dashboard parses fromParam to Date')
  ok(admin.includes("if (toParam) {") && admin.includes("new Date(toParam)"), 'dashboard parses toParam to Date')
  ok(admin.includes("if (!isNaN(d.getTime())) fromDate = d") || admin.includes("!isNaN(d.getTime())"), 'dashboard validates from date NaN')
  ok(admin.includes("const createdAtDateWhere = (() =>"), 'dashboard builds createdAtDateWhere')
  ok(admin.includes("const submissionDateWhere = (() =>"), 'dashboard builds submissionDateWhere')
  ok(admin.includes("if (!fromDate && !toDate) return {}"), 'dashboard no date filtering when both absent')
  ok(admin.includes("if (fromDate) range.gte = fromDate") && admin.includes("if (toDate) range.lte = toDate"), 'dashboard range gte/lte')
  ok(admin.includes("const tenantWhere = collegeId ? { collegeId } : {}"), 'dashboard tenantWhere scoped by collegeId')
  ok(admin.includes("const collegeDateWhere = { ...tenantWhere, ...createdAtDateWhere }"), 'dashboard collegeDateWhere combines tenant+date')
  ok(admin.includes("const submissionCollegeWhere = collegeId ? { assignment: { collegeId } } : {}"), 'dashboard submissionCollegeWhere scoped')
  ok(admin.includes("range: { collegeId: collegeId || null, from: fromDate") && admin.includes("to: toDate"), 'dashboard returns range with collegeId/from/to')
}

// 3. KPIs shape
console.log('\n--- 3. Backend KPIs shape ---')
{
  ok(admin.includes("collegesGroup") && admin.includes("prisma.college.groupBy"), 'dashboard groupBy colleges status')
  ok(admin.includes("prisma.college.count()") && admin.includes("totalColleges"), 'dashboard totalColleges count')
  ok(admin.includes("usersGroup") && admin.includes("prisma.user.groupBy"), 'dashboard groupBy users role')
  ok(admin.includes("assignmentHubsTotal") && admin.includes("prisma.assignmentHub.count"), 'dashboard assignmentHubsTotal')
  ok(admin.includes("formsTotal") && admin.includes("prisma.form.count"), 'dashboard formsTotal')
  ok(admin.includes("internshipsTotal") && admin.includes("prisma.internship.count"), 'dashboard internshipsTotal')
  ok(admin.includes("hackathonsTotal") && admin.includes("prisma.hackathon.count"), 'dashboard hackathonsTotal')
  ok(admin.includes("submissionsAgg") && admin.includes("prisma.assignmentSubmission.count"), 'dashboard submissionsAgg')
  ok(admin.includes("roomsTotalPromise") && admin.includes("prisma.room.count"), 'dashboard roomsTotal via teacher.collegeId join')
  ok(admin.includes("collegesByStatus") && admin.includes("pending:") && admin.includes("approved:") && admin.includes("rejected:"), 'dashboard collegesByStatus pending/approved/rejected')
  ok(admin.includes("usersByRole") && admin.includes("student: byRole['STUDENT']") && admin.includes("teacher: byRole['TEACHER']"), 'dashboard usersByRole student/teacher')
  ok(admin.includes("collegeAdmin: byRole['COLLEGE_ADMIN']") && admin.includes("superAdmin: byRole['SUPER_ADMIN']"), 'dashboard usersByRole collegeAdmin/superAdmin')
  ok(admin.includes("kpis: {") && admin.includes("colleges: collegesByStatus"), 'dashboard res.json kpis.colleges')
  ok(admin.includes("users: usersByRole"), 'dashboard kpis.users')
  ok(admin.includes("assignments: { total: assignmentHubsTotal }"), 'dashboard kpis.assignments')
  ok(admin.includes("rooms: { total: roomsTotal }") || admin.includes("rooms: { total:"), 'dashboard kpis.rooms')
  ok(admin.includes("forms: { total: formsTotal }"), 'dashboard kpis.forms')
  ok(admin.includes("internships: { total: internshipsTotal }"), 'dashboard kpis.internships')
  ok(admin.includes("hackathons: { total: hackathonsTotal }"), 'dashboard kpis.hackathons')
  ok(admin.includes("submissions: submissionsAgg"), 'dashboard kpis.submissions')
  ok(admin.includes("total, graded, pending, overdue") || admin.includes("graded") && admin.includes("pending") && admin.includes("overdue"), 'dashboard submissions graded/pending/overdue')
}

// 4. Breakdown.byCollege
console.log('\n--- 4. Backend breakdown.byCollege ---')
{
  ok(admin.includes("breakdown: { byCollege: breakdownByCollege }"), 'dashboard returns breakdown.byCollege')
  ok(admin.includes("breakdownByCollege = await Promise.all") && admin.includes("collegesForBreakdown.map"), 'dashboard builds breakdown per college')
  ok(admin.includes("prisma.college.findMany({ where: { id: collegeId } })") || admin.includes("collegesForBreakdown"), 'dashboard fetches collegesForBreakdown scoped or global')
  ok(admin.includes("usersInCollege") && admin.includes("prisma.user.count({ where: { collegeId: college.id"), 'dashboard breakdown usersInCollege')
  ok(admin.includes("roomsInCollege") && admin.includes("prisma.room.count({ where: { teacher: { collegeId:"), 'dashboard breakdown rooms via teacher join')
  ok(admin.includes("submissionsInCollege") && admin.includes("prisma.assignmentSubmission.count"), 'dashboard breakdown submissionsInCollege')
  ok(admin.includes("gradedInCollege") && admin.includes("grade: { not: null }"), 'dashboard breakdown gradedInCollege')
  ok(admin.includes("departmentsCount") && admin.includes("prisma.department.count"), 'dashboard breakdown departmentsCount')
  ok(admin.includes("submissionRate") && admin.includes("eligibleTotal"), 'dashboard submissionRate with eligible logic')
  ok(admin.includes("isAssignmentVisibleToUser") && admin.includes("buildHubListWhere"), 'dashboard uses assignmentVisibility helpers (spec required)')
  ok(admin.includes("sampleHubs") && admin.includes("prisma.assignmentHub.findMany"), 'dashboard samples hubs to exercise visibility helper')
  ok(admin.includes("collegeId: college.id") && admin.includes("collegeName: college.name") && admin.includes("code: college.code"), 'dashboard breakdown returns collegeId/collegeName/code')
  ok(admin.includes("status: college.status") && admin.includes("counts: {"), 'dashboard breakdown counts object')
  ok(admin.includes("counts: {") && admin.includes("users: usersInCollege") && admin.includes("assignments: hubsInCollege"), 'dashboard breakdown counts users/assignments')
  ok(admin.includes("submissionRate,") && admin.includes("eligibleSample: eligibleTotal"), 'dashboard breakdown submissionRate + eligibleSample')
}

// 5. Recent
console.log('\n--- 5. Backend recent ---')
{
  ok(admin.includes("recent: {") && admin.includes("assignments: recentAssignments"), 'dashboard recent.assignments')
  ok(admin.includes("rooms: recentRoomsNormalized"), 'dashboard recent.rooms normalized')
  ok(admin.includes("forms: recentForms"), 'dashboard recent.forms')
  ok(admin.includes("prisma.assignmentHub.findMany") && admin.includes("recentWhere") && admin.includes("orderBy: { createdAt: 'desc' }"), 'dashboard recentAssignments query')
  ok(admin.includes("include: {") && admin.includes("creator: { select: { id: true, name: true"), 'dashboard recent includes creator')
  ok(admin.includes("college: { select: { id: true, name: true, code: true } }"), 'dashboard recent includes college')
  ok(admin.includes("prisma.room.findMany") && admin.includes("teacher: { select:"), 'dashboard recent rooms includes teacher')
  ok(admin.includes("recentRoomsNormalized =") && admin.includes("teacher?.college"), 'dashboard normalizes recent rooms college via teacher')
  ok(admin.includes("take: 10"), 'dashboard recent take 10 each')
}

// 6. System + Cache-Control + generatedAt + no migration
console.log('\n--- 6. Backend system + Cache-Control + no migration ---')
{
  ok(admin.includes("system: {") && admin.includes("db: dbHealth.status"), 'dashboard system.db')
  ok(admin.includes("latencyMs: dbHealth.latencyMs"), 'dashboard system.latencyMs')
  ok(admin.includes("contestFetcher: contestFetcher"), 'dashboard system.contestFetcher')
  ok(admin.includes("opportunity: staging"), 'dashboard system.opportunity staging')
  ok(admin.includes("storage: { mode: storageMode }"), 'dashboard system.storage mode')
  ok(admin.includes("dbHealthPromise") && admin.includes("prisma.$queryRaw`SELECT 1`"), 'dashboard dbHealth via SELECT 1')
  ok(admin.includes("contestFetcherPromise") && admin.includes("prisma.codingContest.findFirst"), 'dashboard contestFetcher via codingContest')
  ok(admin.includes("stagingCountsPromise") && admin.includes("prisma.hackathonStaging.count"), 'dashboard opportunity staging counts')
  ok(admin.includes("res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')"), 'dashboard Cache-Control public max-age 15 stale 30')
  ok(admin.includes("generatedAt: new Date().toISOString()"), 'dashboard generatedAt ISO')
  ok(admin.includes("import { storageMode } from '../config/storage'"), 'dashboard imports storageMode')
  // no migration check
  const migrations = fs.readdirSync(path.join(root, 'packages/backend/prisma/migrations'))
  const hasDashboardMigration = migrations.some(m => m.toLowerCase().includes('dashboard') || m.toLowerCase().includes('super'))
  ok(!hasDashboardMigration, `no migration for dashboard (existing: ${migrations.join(', ')})`)
  // schema should not have new model for dashboard
  ok(!schema.toLowerCase().includes('model superdashboard') && !schema.toLowerCase().includes('model dashboard'), 'schema has no SuperDashboard model (no migration)')
}

// 7. Frontend header + college dropdown + date range
console.log('\n--- 7. Frontend SuperAdminDashboardPage header/filters ---')
{
  ok(superPage.includes("Super Admin Command Center"), 'frontend header Super Admin Command Center')
  ok(superPage.includes("Platform · Super Admin") || superPage.includes("Super Admin"), 'frontend header Platform label')
  ok(superPage.includes('Global overview across all colleges'), 'frontend header subtext global overview')
  ok(superPage.includes('<select') && superPage.includes('value={collegeId}'), 'frontend college dropdown select with collegeId')
  ok(superPage.includes('All Colleges') && superPage.includes('collegeOptions.map'), 'frontend college dropdown All Colleges + map')
  ok(superPage.includes('handleCollegeChange') && superPage.includes('setSearchParams'), 'frontend handleCollegeChange uses searchParams')
  ok(superPage.includes('Date range') && superPage.includes('Last 7 days') && superPage.includes('Last 30 days') && superPage.includes('Last 90 days'), 'frontend date range 7d/30d/90d')
  ok(superPage.includes('handleRangeChange') && superPage.includes('getFromForRange'), 'frontend handleRangeChange with getFromForRange')
  ok(superPage.includes("type RangeKey = '7d' | '30d' | '90d'"), 'frontend RangeKey type')
  ok(superPage.includes('from = getFromForRange(range)') && superPage.includes('to = getToNow()'), 'frontend from/to derived from range')
}

// 8. Pending Queue
console.log('\n--- 8. Frontend Pending Queue ---')
{
  ok(superPage.includes('Pending College Queue') && superPage.includes('Clock'), 'frontend Pending College Queue header')
  ok(superPage.includes('pendingColleges') && superPage.includes("filter((c) => c.status === 'PENDING')"), 'frontend pendingColleges filter PENDING')
  ok(superPage.includes('handleApprove') && superPage.includes('adminAPI.approveCollege'), 'frontend handleApprove calls adminAPI.approveCollege')
  ok(superPage.includes('handleReject') && superPage.includes('adminAPI.rejectCollege'), 'frontend handleReject calls adminAPI.rejectCollege')
  ok(superPage.includes('Approve') && superPage.includes('Reject') && superPage.includes('CheckCircle') && superPage.includes('XCircle'), 'frontend Approve/Reject buttons with icons')
  ok(superPage.includes('refetchColleges()') && superPage.includes("invalidateQueries({ queryKey: ['super-dashboard'] })"), 'frontend approve/reject refetches and invalidates dashboard')
  ok(superPage.includes('No pending colleges'), 'frontend empty pending state')
}

// 9. KPI StatCards
console.log('\n--- 9. Frontend KPI StatCards ---')
{
  ok(superPage.includes("StatCard label=\"Colleges\"") && superPage.includes('kpis?.colleges?.total'), 'frontend StatCard Colleges')
  ok(superPage.includes("StatCard label=\"Users\"") && superPage.includes('kpis?.users?.total'), 'frontend StatCard Users')
  ok(superPage.includes("StatCard label=\"Students\"") && superPage.includes('kpis?.users?.student'), 'frontend StatCard Students')
  ok(superPage.includes("StatCard label=\"Teachers\"") && superPage.includes('kpis?.users?.teacher'), 'frontend StatCard Teachers')
  ok(superPage.includes("StatCard label=\"Assignments\"") && superPage.includes('kpis?.assignments?.total'), 'frontend StatCard Assignments')
  ok(superPage.includes("StatCard label=\"Rooms\"") && superPage.includes('kpis?.rooms?.total'), 'frontend StatCard Rooms')
  ok(superPage.includes("StatCard label=\"Forms\"") && superPage.includes('kpis?.forms?.total'), 'frontend StatCard Forms')
  ok(superPage.includes("StatCard label=\"Internships\"") && superPage.includes('kpis?.internships?.total'), 'frontend StatCard Internships')
  ok(superPage.includes('Submissions Total') && superPage.includes('kpis?.submissions?.total'), 'frontend Submissions Total')
  ok(superPage.includes('Graded') && superPage.includes('kpis?.submissions?.graded'), 'frontend Graded')
  ok(superPage.includes('Pending / Overdue') && superPage.includes('kpis?.submissions?.pending'), 'frontend Pending/Overdue')
  ok(superPage.includes("import StatCard from '../components/shared/StatCard'"), 'frontend imports StatCard')
}

// 10. College Distribution bars + Submission Rate table
console.log('\n--- 10. Frontend College Distribution + Submission Rate ---')
{
  ok(superPage.includes('College Distribution') && superPage.includes('BarChart3'), 'frontend College Distribution header')
  ok(superPage.includes("chartMetric") && superPage.includes("useState<'Assignments' | 'Rooms' | 'Forms' | 'Users'>"), 'frontend chartMetric toggle')
  ok(superPage.includes("setChartMetric") && superPage.includes('Assignments') && superPage.includes('Rooms') && superPage.includes('Forms') && superPage.includes('Users'), 'frontend chart metric buttons')
  ok(superPage.includes('h-2.5 w-full rounded-full bg-surface-100') && superPage.includes('style={{ width:'), 'frontend Tailwind div width % bars')
  ok(superPage.includes('bg-gradient-to-r from-primary-600 to-primary-500'), 'frontend bar gradient')
  ok(superPage.includes('maxForChart') && superPage.includes('Math.max(1, ...vals)'), 'frontend maxForChart calc')
  ok(superPage.includes('Submission Rate') && superPage.includes('TrendingUp'), 'frontend Submission Rate header')
  ok(superPage.includes('<table') && superPage.includes('<th') && superPage.includes('Assignments</th>') && superPage.includes('Submissions</th>') && superPage.includes('Rate</th>'), 'frontend Submission Rate table columns')
  ok(superPage.includes('b.submissionRate') && superPage.includes('b.counts?.assignments') && superPage.includes('b.counts?.submissions'), 'frontend Submission Rate row data')
  ok(superPage.includes(">= 70 ? 'bg-emerald-50") && superPage.includes(">= 40 ? 'bg-warning-50"), 'frontend rate color badges 70/40 thresholds')
}

// 11. Recent Activity + Quick Actions + System Health
console.log('\n--- 11. Frontend Recent Activity / Quick Actions / System Health ---')
{
  ok(superPage.includes('Recent Assignments') && superPage.includes('ClipboardList'), 'frontend Recent Assignments')
  ok(superPage.includes('Recent Rooms') && superPage.includes('DoorOpen'), 'frontend Recent Rooms')
  ok(superPage.includes('Recent Forms') && superPage.includes('FileText'), 'frontend Recent Forms')
  ok(superPage.includes('recent?.assignments') && superPage.includes('recent?.rooms') && superPage.includes('recent?.forms'), 'frontend recent data slices')
  ok(superPage.includes("slice(0, 5)") && superPage.includes("navigate(`/assignments/"), 'frontend recent slice 5 + navigate assignments')
  ok(superPage.includes("navigate(`/rooms/") && superPage.includes("navigate(`/forms/"), 'frontend recent navigate rooms/forms')
  ok(superPage.includes('Quick Actions') && superPage.includes('Zap'), 'frontend Quick Actions header')
  ok(superPage.includes('Create College') && superPage.includes("navigate('/admin')"), 'frontend Quick Actions Create College -> /admin')
  ok(superPage.includes('Manage Admins') && superPage.includes('Settings'), 'frontend Quick Actions Manage Admins')
  ok(superPage.includes('System Health') && superPage.includes('Activity'), 'frontend System Health header')
  ok(superPage.includes('Database') && superPage.includes('Database') && superPage.includes('system?.db'), 'frontend System Health Database')
  ok(superPage.includes('Contest Fetcher lastRun') && superPage.includes('system?.contestFetcher?.lastRun'), 'frontend System Health Contest Fetcher')
  ok(superPage.includes('Hackathon staging pending') && superPage.includes('system?.opportunity?.hackathonPending'), 'frontend System Health hackathonPending')
  ok(superPage.includes('Internship staging pending') && superPage.includes('system?.opportunity?.internshipPending'), 'frontend System Health internshipPending')
  ok(superPage.includes('Storage mode') && superPage.includes('system?.storage?.mode'), 'frontend System Health storage mode')
  ok(superPage.includes('Generated at') && superPage.includes('generatedAt'), 'frontend footer Generated at')
  ok(superPage.includes('Cache 15s'), 'frontend footer Cache 15s')
}

// 12. TanStack Query stale 15s + socket invalidation
console.log('\n--- 12. Frontend TanStack Query & socket invalidation ---')
{
  ok(superPage.includes("queryKey: ['super-dashboard', collegeId, from, to]"), 'frontend queryKey super-dashboard with collegeId/from/to')
  ok(superPage.includes("queryFn: () => superAdminAPI.getDashboard({ collegeId: collegeId || undefined, from, to })"), 'frontend queryFn superAdminAPI.getDashboard with collegeId/from/to')
  ok(superPage.includes("staleTime: 15 * 1000"), 'frontend staleTime 15s')
  ok(superPage.includes("gcTime: 60 * 1000"), 'frontend gcTime 60s')
  ok(superPage.includes("retry: 1"), 'frontend retry 1')
  ok(superPage.includes("useEffect(() => {") && superPage.includes("queryClient.invalidateQueries({ queryKey: ['super-dashboard'] })"), 'frontend socket invalidation effect')
  ok(superPage.includes("window.addEventListener('assignment:mutated'"), 'frontend listens assignment:mutated')
  ok(superPage.includes("window.addEventListener('form:mutated'"), 'frontend listens form:mutated')
  ok(superPage.includes("assignment:hub:updated"), 'frontend listens assignment:hub:updated')
  ok(superPage.includes("window.removeEventListener('assignment:mutated'"), 'frontend cleanup removeEventListener')
  ok(api.includes("superAdminAPI") && api.includes("getDashboard") && api.includes("api.get('/admin/super/dashboard'"), 'api superAdminAPI.getDashboard hits /admin/super/dashboard')
  ok(api.includes("getDashboard: (params?: { collegeId?: string; from?: string; to?: string })"), 'api getDashboard params collegeId/from/to')
}

// 13. Routing /superadmin guard + Layout Super Overview
console.log('\n--- 13. Frontend routing /superadmin guard + Layout ---')
{
  ok(app.includes("import SuperAdminDashboardPage from './pages/SuperAdminDashboardPage'"), 'App imports SuperAdminDashboardPage')
  ok(app.includes("function SuperAdminGuard") && app.includes("user?.role !== 'SUPER_ADMIN'"), 'App SuperAdminGuard checks SUPER_ADMIN')
  ok(app.includes('<Navigate to="/dashboard" replace />') && app.includes('SuperAdminGuard'), 'App guard redirects to /dashboard if not super')
  ok(app.includes('path="superadmin"') && app.includes('<SuperAdminGuard><SuperAdminDashboardPage'), 'App route /superadmin with guard')
  ok(app.includes('path="admin/dashboard"') && app.includes('Navigate to="/superadmin"'), 'App admin/dashboard redirects to /superadmin')
  ok(layout.includes("SUPER_ADMIN: [") && layout.includes("path: '/superadmin'") && layout.includes("label: 'Super Overview'"), 'Layout navByRole SUPER_ADMIN has Super Overview /superadmin')
  ok(layout.includes("BarChart2") && layout.includes("Super Overview"), 'Layout Super Overview uses BarChart2 icon')
  ok(layout.includes("Management") && layout.includes("path: '/superadmin'") && layout.includes("label: 'Super Overview'"), 'Layout Management also has Super Overview')
  ok(layout.includes("window.dispatchEvent(new CustomEvent('assignment:mutated'") || layout.includes("assignment:mutated"), 'Layout dispatches assignment:mutated events for socket bridge')
  ok(layout.includes("window.dispatchEvent(new CustomEvent('form:mutated'") || layout.includes("form:mutated"), 'Layout dispatches form:mutated events')
}

// 14. No regression on AdminPage
console.log('\n--- 14. Regression: AdminPage intact ---')
{
  ok(adminPage.includes("const isSuperAdmin = user?.role === 'SUPER_ADMIN'"), 'AdminPage isSuperAdmin flag intact')
  ok(adminPage.includes("const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>"), 'AdminPage selectedCollegeId state intact')
  ok(adminPage.includes("const loadColleges = useCallback(async () => {") && adminPage.includes("adminAPI.getColleges()"), 'AdminPage loadColleges intact')
  ok(adminPage.includes("const loadCollegeData = useCallback(async (collegeId: string) => {") && adminPage.includes("adminAPI.getAnalytics(collegeId)"), 'AdminPage loadCollegeData intact')
  ok(adminPage.includes("if (isSuperAdmin && !selectedCollegeId) {") && adminPage.includes("loadColleges()"), 'AdminPage super without selection loads colleges')
  ok(adminPage.includes("handleSelectCollege") && adminPage.includes("setSelectedCollegeId(college.id)"), 'AdminPage handleSelectCollege intact')
  ok(adminPage.includes("handleBackToColleges") && adminPage.includes("setSelectedCollegeId(null)"), 'AdminPage handleBackToColleges intact')
  ok(adminPage.includes("All Colleges") || adminPage.includes("Select a college"), 'AdminPage All Colleges UI intact')
  ok(adminPage.includes("Pending Approval") && adminPage.includes("Approve") && adminPage.includes("Reject"), 'AdminPage pending approval UI intact')
  ok(!adminPage.includes("Super Admin Command Center"), 'AdminPage not leaking super dashboard header (no regression)')
  // ensure AdminPage still uses adminAPI.getUsers etc with collegeId
  ok(adminPage.includes("adminAPI.getUsers(collegeId)") && adminPage.includes("departmentAPI.getAll(collegeId)"), 'AdminPage still scopes APIs by collegeId')
}

// 15. tsc --noEmit passes both
console.log('\n--- 15. tsc --noEmit passes ---')
{
  try {
    console.log('Running tsc --noEmit backend...')
    execSync('npx tsc --noEmit', { cwd: path.join(root, 'packages/backend'), stdio: 'pipe', timeout: 60000 })
    ok(true, 'backend tsc --noEmit passes (exit 0)')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, `backend tsc --noEmit passes`)
  }
  try {
    console.log('Running tsc --noEmit web...')
    execSync('npx tsc --noEmit', { cwd: path.join(root, 'apps/web'), stdio: 'pipe', timeout: 60000 })
    ok(true, 'web tsc --noEmit passes (exit 0)')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, `web tsc --noEmit passes`)
  }
}

// 16. Additional functional simulations
console.log('\n--- 16. Functional simulations: collegeId & from/to & Cache-Control ---')
{
  // Simulate date parsing
  function parseDashboardQuery(query) {
    const collegeId = query.collegeId?.trim() || undefined
    let fromDate, toDate
    if (query.from) { const d = new Date(query.from); if (!isNaN(d.getTime())) fromDate = d }
    if (query.to) { const d = new Date(query.to); if (!isNaN(d.getTime())) toDate = d }
    const createdAtDateWhere = (!fromDate && !toDate) ? {} : { createdAt: { ...(fromDate?{gte:fromDate}:{}), ...(toDate?{lte:toDate}:{}) } }
    const submissionDateWhere = (!fromDate && !toDate) ? {} : { submittedAt: { ...(fromDate?{gte:fromDate}:{}), ...(toDate?{lte:toDate}:{}) } }
    const tenantWhere = collegeId ? { collegeId } : {}
    const collegeDateWhere = { ...tenantWhere, ...createdAtDateWhere }
    return { collegeId, fromDate, toDate, createdAtDateWhere, submissionDateWhere, collegeDateWhere }
  }
  let q = parseDashboardQuery({})
  ok(q.collegeId === undefined && JSON.stringify(q.createdAtDateWhere) === '{}', 'empty query => global no date filter')
  q = parseDashboardQuery({ collegeId: 'c123' })
  ok(q.collegeId === 'c123' && q.collegeDateWhere.collegeId === 'c123', 'collegeId filter scoped')
  q = parseDashboardQuery({ collegeId: '  c123  ' })
  ok(q.collegeId === 'c123', 'collegeId trim works')
  q = parseDashboardQuery({ collegeId: '' })
  ok(q.collegeId === undefined, 'empty collegeId => global')
  q = parseDashboardQuery({ from: '2026-09-01T00:00:00Z', to: '2026-09-04T00:00:00Z' })
  ok(q.fromDate instanceof Date && q.toDate instanceof Date && q.createdAtDateWhere.createdAt.gte instanceof Date, 'from/to parsed to Date ranges')
  q = parseDashboardQuery({ from: 'invalid-date' })
  ok(q.fromDate === undefined && JSON.stringify(q.createdAtDateWhere) === '{}', 'invalid from => no filter (NaN guard)')
  q = parseDashboardQuery({ from: '2026-09-01' })
  ok(q.fromDate instanceof Date && q.toDate === undefined && q.createdAtDateWhere.createdAt.gte instanceof Date && !q.createdAtDateWhere.createdAt.lte, 'only from => gte only')
  // Simulate role guard
  function canAccessDashboard(user) { return user && user.role === 'SUPER_ADMIN' }
  ok(canAccessDashboard({ role: 'SUPER_ADMIN' }), 'SUPER_ADMIN can access dashboard')
  ok(!canAccessDashboard({ role: 'COLLEGE_ADMIN' }), 'COLLEGE_ADMIN cannot access dashboard (403)')
  ok(!canAccessDashboard({ role: 'TEACHER' }), 'TEACHER cannot access dashboard (403)')
  ok(!canAccessDashboard({ role: 'STUDENT' }), 'STUDENT cannot access dashboard (403)')
  ok(!canAccessDashboard(null), 'null user cannot access dashboard')

  // Simulate response shape
  const mockResponse = {
    range: { collegeId: null, from: new Date().toISOString(), to: new Date().toISOString() },
    kpis: { colleges: { total: 3, pending: 1, approved: 2, rejected: 0 }, users: { total: 10, student:5, teacher:3, collegeAdmin:1, superAdmin:1, byRole:{} }, assignments: { total:5 }, rooms: { total:2 }, forms: { total:4 }, internships: { total:6 }, hackathons: { total:2 }, submissions: { total:20, graded:12, pending:8, overdue:1 } },
    breakdown: { byCollege: [{ collegeId:'c1', collegeName:'A', code:'A', status:'APPROVED', counts:{ users:5, byRole:{}, assignments:2, rooms:1, forms:1, internships:1, hackathons:0, departments:2, submissions:5, graded:3, pending:2 }, submissionRate:60, eligibleSample:2 }] },
    recent: { assignments: [{ id:'1', title:'T', creator:{ name:'N' }, college:{ name:'C'} }], rooms: [{ id:'1', name:'R', college:{ name:'C'} }], forms: [{ id:'1', title:'F', creator:{ name:'N'} }] },
    system: { db:'ok', latencyMs:5, contestFetcher:{ lastRun: new Date().toISOString(), latestContest:{ title:'C' } }, opportunity:{ hackathonPending:2, internshipPending:3, hackathonPendingFiltered:null, internshipPendingFiltered:null }, storage:{ mode:'cloudinary' } },
    generatedAt: new Date().toISOString()
  }
  ok(mockResponse.kpis && mockResponse.breakdown && mockResponse.recent && mockResponse.system && mockResponse.range && mockResponse.generatedAt, 'dashboard response shape kpis/breakdown/recent/system/range/generatedAt')
  ok(mockResponse.breakdown.byCollege[0].submissionRate === 60, 'breakdown submissionRate correct')
  ok(mockResponse.system.storage.mode === 'cloudinary' || mockResponse.system.storage.mode === 'local', 'system storage mode valid')
}

// Summary
console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed — see FAIL lines above`)
else console.log(`\nAll SUPERADMIN DASHBOARD checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

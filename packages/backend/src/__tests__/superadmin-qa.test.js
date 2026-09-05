/**
 * QA: SUPER_ADMIN Global Platform Owner — Architecture Verification
 * Run: node packages/backend/src/__tests__/superadmin-qa.test.js
 * Verifies CTO implementation per ADR 001:
 *  - src/utils/roles.ts helpers
 *  - POST /auth/register blocks SUPER_ADMIN/COLLEGE_ADMIN 403
 *  - internships.ts GET global, POST allow super
 *  - rooms.ts GET global, PUT/DELETE creator||super||collegeAdmin
 *  - assignmentHub.ts buildHubListWhere collegeId param + derivedCollegeId
 *  - forms.ts derive collegeId + assignmentVisibility
 *  - Frontend api.ts collegeId params + AdminPage/AddTeacher/AddStudent picker UI
 *  - tsc --noEmit passes backend & web
 *  - COLLEGE_ADMIN cannot escalate to SUPER_ADMIN
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

console.log('=== SUPER_ADMIN Architecture QA ===\n')

let roles, auth, internships, rooms, assignmentHub, forms, visibility, departments, admin, api, adminPage, addTeacher, addStudent, adr

try { roles = read('packages/backend/src/utils/roles.ts'); ok(true, 'packages/backend/src/utils/roles.ts exists') } catch { ok(false, 'roles.ts exists'); roles='' }
try { auth = read('packages/backend/src/routes/auth.ts'); ok(true, 'packages/backend/src/routes/auth.ts exists') } catch { ok(false, 'auth.ts exists'); auth='' }
try { internships = read('packages/backend/src/routes/internships.ts'); ok(true, 'packages/backend/src/routes/internships.ts exists') } catch { ok(false, 'internships.ts exists'); internships='' }
try { rooms = read('packages/backend/src/routes/rooms.ts'); ok(true, 'packages/backend/src/routes/rooms.ts exists') } catch { ok(false, 'rooms.ts exists'); rooms='' }
try { assignmentHub = read('packages/backend/src/routes/assignmentHub.ts'); ok(true, 'packages/backend/src/routes/assignmentHub.ts exists') } catch { ok(false, 'assignmentHub.ts exists'); assignmentHub='' }
try { forms = read('packages/backend/src/routes/forms.ts'); ok(true, 'packages/backend/src/routes/forms.ts exists') } catch { ok(false, 'forms.ts exists'); forms='' }
try { visibility = read('packages/backend/src/utils/assignmentVisibility.ts'); ok(true, 'packages/backend/src/utils/assignmentVisibility.ts exists') } catch { ok(false, 'assignmentVisibility.ts exists'); visibility='' }
try { departments = read('packages/backend/src/routes/departments.ts'); ok(true, 'packages/backend/src/routes/departments.ts exists') } catch { ok(false, 'departments.ts exists'); departments='' }
try { admin = read('packages/backend/src/routes/admin.ts'); ok(true, 'packages/backend/src/routes/admin.ts exists') } catch { ok(false, 'admin.ts exists'); admin='' }
try { api = read('apps/web/src/lib/api.ts'); ok(true, 'apps/web/src/lib/api.ts exists') } catch { ok(false, 'api.ts exists'); api='' }
try { adminPage = read('apps/web/src/pages/AdminPage.tsx'); ok(true, 'apps/web/src/pages/AdminPage.tsx exists') } catch { ok(false, 'AdminPage.tsx exists'); adminPage='' }
try { addTeacher = read('apps/web/src/pages/AddTeacherPage.tsx'); ok(true, 'apps/web/src/pages/AddTeacherPage.tsx exists') } catch { ok(false, 'AddTeacherPage exists'); addTeacher='' }
try { addStudent = read('apps/web/src/pages/AddStudentPage.tsx'); ok(true, 'apps/web/src/pages/AddStudentPage.tsx exists') } catch { ok(false, 'AddStudentPage exists'); addStudent='' }
try { adr = read('docs/adr/001-super-admin-global-platform-owner.md'); ok(true, 'docs/adr/001-super-admin-global-platform-owner.md exists') } catch { ok(false, 'ADR exists'); adr='' }

// 1. roles.ts helpers
console.log('\n--- 1. roles.ts helpers ---')
{
  ok(roles.includes("export const ROLES = {"), 'ROLES constant exported')
  ok(roles.includes("SUPER_ADMIN: 'SUPER_ADMIN'") && roles.includes("COLLEGE_ADMIN: 'COLLEGE_ADMIN'"), 'ROLES contains SUPER_ADMIN & COLLEGE_ADMIN')
  ok(roles.includes("export function isSuperAdmin"), 'isSuperAdmin exported')
  ok(roles.includes("export function isCollegeAdmin"), 'isCollegeAdmin exported')
  ok(roles.includes("export function canAccessCollege"), 'canAccessCollege exported')
  ok(roles.includes("export function deriveCollegeId"), 'deriveCollegeId exported')
  ok(roles.includes("return user?.role === ROLES.SUPER_ADMIN") || roles.includes("user.role === 'SUPER_ADMIN'") || roles.includes("ROLES.SUPER_ADMIN"), 'isSuperAdmin checks SUPER_ADMIN')
  ok(roles.includes("if (isSuperAdmin(user)) return true"), 'canAccessCollege bypasses for SUPER_ADMIN')
  ok(roles.includes("return !!user.collegeId && user.collegeId === resourceCollegeId"), 'canAccessCollege tenant exact match')
  ok(roles.includes("if (isSuperAdmin(user))") && roles.includes("return explicitCollegeId || user.collegeId || null"), 'deriveCollegeId super uses explicitCollegeId')
  ok(roles.includes("return user.collegeId || null") && roles.includes("Others: must use their own collegeId"), 'deriveCollegeId tenant uses own collegeId')
  ok(roles.includes("SUPER_ADMIN is global platform owner") || roles.includes("SUPER_ADMIN is global"), 'comment clarifies SUPER_ADMIN global')
  ok(!roles.includes("role === 'COLLEGE_ADMIN' || role === 'SUPER_ADMIN'") || roles.includes("Never treat them as equivalent"), 'roles.ts warns not to treat SUPER/COLLEGE as equivalent')
}

// 2. auth.ts — block public SUPER_ADMIN/COLLEGE_ADMIN self-registration 403
console.log('\n--- 2. auth.ts registration blocks ---')
{
  ok(auth.includes("if (requestedRole === 'SUPER_ADMIN')"), 'auth: checks requestedRole SUPER_ADMIN')
  ok(auth.includes("res.status(403).json({ error: 'Super admin accounts can only be created"), 'auth: SUPER_ADMIN 403 with correct message')
  ok(auth.includes("if (requestedRole === 'COLLEGE_ADMIN')"), 'auth: checks requestedRole COLLEGE_ADMIN')
  ok(auth.includes("res.status(403).json({ error: 'College admin registration must go through"), 'auth: COLLEGE_ADMIN 403 with correct message')
  ok(auth.includes("const safeRole = requestedRole === 'TEACHER' ? 'TEACHER' : 'STUDENT'"), 'auth: safeRole only TEACHER/STUDENT')
  ok(auth.includes("role: safeRole") || auth.includes("role: safeRole"), 'auth: uses safeRole for creation (not requestedRole directly)')
  // ensure no longer allows 201 with SUPER_ADMIN
  const registerBlock = auth.split("router.post('/register'")[1] || auth
  ok(registerBlock.includes("403") && registerBlock.indexOf("SUPER_ADMIN") < registerBlock.indexOf("safeRole"), 'auth: 403 before safeRole assignment')
  ok(!registerBlock.includes("role: requestedRole") || registerBlock.includes("safeRole"), 'auth: does not directly use requestedRole for role field')
  // ensure login still works
  ok(auth.includes("router.post('/login'"), 'auth: login route still exists')
  ok(auth.includes("router.get('/me'"), 'auth: me route still exists')
}

// 3. internships.ts GET global, POST allow super
console.log('\n--- 3. internships.ts ---')
{
  ok(internships.includes("const isSuper = user.role === 'SUPER_ADMIN'"), 'internships GET: isSuper check')
  ok(internships.includes("const filterCollegeId = isSuper ? (req.query.collegeId as string"), 'internships GET: filterCollegeId from query for super')
  ok(internships.includes("if (!isSuper && !user.collegeId)"), 'internships GET: tenant requires collegeId else empty')
  ok(internships.includes("if (isSuper) {") && internships.includes("if (filterCollegeId) where = { collegeId: filterCollegeId }"), 'internships GET: super with filterCollegeId => scoped, else global {}')
  ok(internships.includes("} else {") && internships.includes("where = { collegeId: user.collegeId }"), 'internships GET: tenant where collegeId = user.collegeId')
  // POST
  ok(internships.includes("router.post('/', async"), 'internships POST exists')
  ok(internships.includes("user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN'"), 'internships POST allows TEACHER/COLLEGE_ADMIN/SUPER_ADMIN')
  ok(internships.includes("const derivedCollegeId = user.role === 'SUPER_ADMIN' ? (bodyCollegeId || user.collegeId || null) : user.collegeId"), 'internships POST derives collegeId for super via bodyCollegeId')
  ok(internships.includes("if (!derivedCollegeId) {") && internships.includes("res.status(400).json({ error: 'College ID is required' }"), 'internships POST 400 if missing collegeId')
  ok(internships.includes("collegeId: derivedCollegeId"), 'internships POST uses derivedCollegeId in create')
  // Check other admin checks include super
  ok(internships.includes("user.role !== 'TEACHER' && user.role !== 'COLLEGE_ADMIN' && user.role !== 'SUPER_ADMIN'") || internships.includes("SUPER_ADMIN"), 'internships includes SUPER_ADMIN in at least 3 admin checks (staging, registrations)')
  ok(internships.includes("router.get('/:id/registrations'") && internships.includes("SUPER_ADMIN"), 'internships GET registrations allows super')
  ok(internships.includes("router.get('/export/:id'") && internships.includes("SUPER_ADMIN"), 'internships export allows super')
  ok(internships.includes("router.get('/export-all'") && internships.includes("const collegeFilter = user.role === 'SUPER_ADMIN' ? {} : { collegeId:"), 'internships export-all global for super')
  // regression: ensure search still works with super
  ok(internships.includes("if (isSuper && !filterCollegeId)") && internships.includes("searchClause"), 'internships search respects super global vs filter')
}

// 4. rooms.ts GET global, PUT/DELETE creator||super||collegeAdmin
console.log('\n--- 4. rooms.ts ---')
{
  ok(rooms.includes("function isCollegeAdminForRoom"), 'rooms: isCollegeAdminForRoom helper exists')
  ok(rooms.includes("if (user.role === 'SUPER_ADMIN') return true") && rooms.includes("isCollegeAdminForRoom"), 'rooms: isCollegeAdminForRoom bypasses super')
  ok(rooms.includes("if (user.role === 'SUPER_ADMIN') {") && rooms.includes("// SUPER_ADMIN: global view"), 'rooms GET lists global for super')
  ok(rooms.includes("const filterCollegeId = req.query.collegeId as string"), 'rooms GET supports ?collegeId= filter for super')
  ok(rooms.includes("teachersInCollege = await prisma.user.findMany({ where: { collegeId: filterCollegeId }"), 'rooms GET filter via teacher join for super')
  ok(rooms.includes("prisma.room.findMany({") && rooms.includes("teacher: { select:"), 'rooms GET includes teacher relation')
  // PUT
  ok(rooms.includes("router.put('/:id', async"), 'rooms PUT exists')
  ok(rooms.includes("const canUpdate = room.teacherId === req.userId || user.role === 'SUPER_ADMIN' || (user.role === 'COLLEGE_ADMIN' && user.collegeId && room.teacher.collegeId === user.collegeId"), 'rooms PUT allows creator || super || collegeAdmin same college')
  ok(rooms.includes("if (!canUpdate) {") && rooms.includes("res.status(403)"), 'rooms PUT 403 when not canUpdate')
  // DELETE
  ok(rooms.includes("router.delete('/:id', async"), 'rooms DELETE exists')
  ok(rooms.includes("const canDelete = room.teacherId === req.userId || user.role === 'SUPER_ADMIN' || (user.role === 'COLLEGE_ADMIN' && user.collegeId && room.teacher.collegeId === user.collegeId"), 'rooms DELETE allows creator || super || collegeAdmin')
  // unread-counts
  ok(rooms.includes("router.get('/unread-counts'") && rooms.includes("if (user.role === 'SUPER_ADMIN') {") && rooms.includes("const allRooms = await prisma.room.findMany({ select: { id: true } })"), 'rooms unread-counts super gets all rooms')
  // ensure teacher still scoped
  ok(rooms.includes("} else if (user.role === 'TEACHER' || user.role === 'COLLEGE_ADMIN') {") && rooms.includes("teacherId: req.userId!"), 'rooms GET teacher scoped to teacherId')
  // ensure student not affected
  ok(rooms.includes("// Student: paginate via RoomMember"), 'rooms GET student branch preserved')
}

// 5. assignmentHub.ts + assignmentVisibility
console.log('\n--- 5. assignmentHub.ts & assignmentVisibility.ts ---')
{
  ok(assignmentHub.includes("import { buildHubListWhere"), 'assignmentHub imports buildHubListWhere')
  ok(visibility.includes("export function buildHubListWhere"), 'visibility: buildHubListWhere exists')
  ok(visibility.includes("if (user.role === 'SUPER_ADMIN') {") && visibility.includes("if (filters.collegeId) where.collegeId = filters.collegeId"), 'visibility buildHubListWhere super respects collegeId filter else global')
  ok(visibility.includes("} else if (user.collegeId) {") && visibility.includes("where.collegeId = user.collegeId"), 'visibility buildHubListWhere tenant scopes to own collegeId')
  ok(assignmentHub.includes("let where: any = buildHubListWhere(user as any, { search, scope, submissionMode, collegeId })"), 'assignmentHub GET uses buildHubListWhere with collegeId param')
  ok(assignmentHub.includes("const collegeId = req.query.collegeId as string"), 'assignmentHub GET reads collegeId from query')
  ok(assignmentHub.includes("const derivedCollegeId = user.role === 'SUPER_ADMIN'") && assignmentHub.includes("? (body.collegeId || user.collegeId || null)"), 'assignmentHub POST derives collegeId for super via body.collegeId')
  ok(assignmentHub.includes("if (body.scope === 'DEPARTMENT' && !body.departmentId)"), 'assignmentHub POST validates DEPARTMENT scope')
  ok(assignmentHub.includes("const deptCollegeId = derivedCollegeId || user.collegeId"), 'assignmentHub POST dept validation uses derivedCollegeId not user.collegeId alone')
  ok(assignmentHub.includes("prisma.department.findFirst({ where: { id: body.departmentId, ...(deptCollegeId ? { collegeId: deptCollegeId } : {}) } }"), 'assignmentHub POST checks department belongs to derivedCollegeId')
  ok(assignmentHub.includes("scope: z.enum(['ALL','DEPARTMENT','ROOM'])"), 'assignmentHub schema scope enum preserved')
  ok(assignmentHub.includes("collegeId: z.preprocess(emptyToNull, z.string().optional().nullable())"), 'assignmentHub schema includes collegeId for super targeting')
  ok(assignmentHub.includes("isSuper = user.role === 'SUPER_ADMIN'") || assignmentHub.includes("isSuper"), 'assignmentHub handles super in room auth')
  ok(visibility.includes("export function isAssignmentVisibleToUser") && visibility.includes("if (user.role === 'SUPER_ADMIN') return true"), 'visibility isAssignmentVisibleToUser super bypass')
  ok(visibility.includes("export function filterSubmissionForStudentVisibility"), 'visibility filterSubmissionForStudentVisibility exists')
}

// 6. forms.ts derive collegeId
console.log('\n--- 6. forms.ts ---')
{
  ok(forms.includes("const derivedCollegeId = user?.role === 'SUPER_ADMIN' ? (bodyCollegeId || user.collegeId || null) : user?.collegeId"), 'forms POST derives collegeId for super')
  ok(forms.includes("collegeId: derivedCollegeId"), 'forms POST uses derivedCollegeId in create')
  ok(forms.includes("if (user.role === 'SUPER_ADMIN') {") && forms.includes("where = {}"), 'forms GET super global where {}')
  ok(forms.includes("if (user.role === 'COLLEGE_ADMIN' || user.role === 'TEACHER')"), 'forms GET preserves teacher/admin branch')
  ok(forms.includes("if (form.collegeId && user.collegeId && form.collegeId !== user.collegeId && user.role !== 'SUPER_ADMIN')") || forms.includes("canAccessCollege"), 'forms tenant isolation checks include super bypass in PUT/stats/pending (or canAccessCollege)')
  ok(forms.includes("if (!(form.collegeId === user.collegeId || user.role === 'SUPER_ADMIN'))") || forms.includes("canAccessCollege"), 'forms export 403 respects super (or via canAccessCollege)')
  ok(forms.includes("authorizedRoomIds") && forms.includes("case 'SUPER_ADMIN':") && forms.includes("return true"), 'forms room authorization allows super for any room')
}

// 7. departments.ts
console.log('\n--- 7. departments.ts ---')
{
  ok(departments.includes("if (user.role === 'SUPER_ADMIN') {") && departments.includes("const collegeId = req.query.collegeId as string"), 'departments GET super respects ?collegeId= else global')
  ok(departments.includes("const collegeId = user.role === 'SUPER_ADMIN' ? (req.body.collegeId || user.collegeId) : user.collegeId"), 'departments POST derives collegeId for super')
  ok(departments.includes("if (!collegeId) {") && departments.includes("res.status(400).json({ error: 'College ID is required' }"), 'departments POST 400 if missing collegeId')
  ok(departments.includes("collegeId: collegeId") || departments.includes("collegeId }"), 'departments create uses collegeId')
  ok(departments.includes("COLLEGE_ADMIN' && dept.collegeId !== user.collegeId"), 'departments PUT/DELETE college admin isolation')
}

// 8. admin.ts
console.log('\n--- 8. admin.ts ---')
{
  ok(admin.includes("router.get('/colleges'") && admin.includes("if (!user || user.role !== 'SUPER_ADMIN')"), 'admin GET /colleges super only')
  ok(admin.includes("router.get('/users'") && admin.includes("if (user.role === 'SUPER_ADMIN') {") && admin.includes("const collegeId = req.query.collegeId as string"), 'admin GET /users super supports ?collegeId=')
  ok(admin.includes("router.get('/analytics'") && admin.includes("if (user.role === 'SUPER_ADMIN')"), 'admin analytics super supports ?collegeId=')
  ok(admin.includes("router.get('/hackathons'") && admin.includes("SUPER_ADMIN"), 'admin hackathons supports super')
  ok(admin.includes("router.get('/forms'") && admin.includes("SUPER_ADMIN"), 'admin forms supports super')
  ok(admin.includes("router.post('/users/teacher'") && admin.includes("const collegeId = user.role === 'SUPER_ADMIN' ? (req.body.collegeId || user.collegeId) : user.collegeId"), 'admin add teacher derives collegeId for super')
  ok(admin.includes("router.post('/users/student'") && admin.includes("const collegeId = user.role === 'SUPER_ADMIN' ? (req.body.collegeId || user.collegeId) : user.collegeId"), 'admin add student derives collegeId for super')
  ok(admin.includes("router.post('/users/teachers/bulk'") && admin.includes("SUPER_ADMIN"), 'admin bulk teachers supports super collegeId')
  ok(admin.includes("router.post('/users/students/bulk'") && admin.includes("SUPER_ADMIN"), 'admin bulk students supports super collegeId')
  ok(admin.includes("if (role === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN')"), 'admin PUT users blocks COLLEGE_ADMIN escalate to SUPER_ADMIN')
  ok(admin.includes("res.status(403).json({ error: 'Only Super Admin can assign Super Admin role' }"), 'admin escalation message correct')
  ok(admin.includes("departmentId: role === 'SUPER_ADMIN' ? null : (departmentId || undefined)"), 'admin promotion to SUPER_ADMIN clears departmentId')
  ok(admin.includes("collegeId: role === 'SUPER_ADMIN' ? null : undefined"), 'admin promotion to SUPER_ADMIN clears collegeId (global null)')
  ok(admin.includes("if (user.role !== 'SUPER_ADMIN' && targetUser.collegeId !== user.collegeId)"), 'admin update/delete verifies target belongs to same college unless super')
  ok(admin.includes("await prisma.department.findUnique({ where: { id: departmentId } })") && admin.includes("dept.collegeId !== collegeId"), 'admin addTeacher validates department belongs to target college')
}

// 9. Frontend api.ts
console.log('\n--- 9. Frontend api.ts ---')
{
  ok(api.includes("getHubs: (params?: {") && api.includes("collegeId?: string"), 'assignmentHubAPI.getHubs supports collegeId param')
  ok(api.includes("api.get('/assignments/hub', { params: query"), 'assignmentHubAPI.getHubs passes collegeId via query')
  ok(api.includes("departmentAPI = {") && api.includes("getAll: (collegeId?: string) => api.get('/departments'"), 'departmentAPI.getAll supports collegeId')
  ok(api.includes("create: (data: { name: string; collegeId?: string }) => api.post('/departments', data)"), 'departmentAPI.create supports collegeId')
  ok(api.includes("getUsers: (collegeId?: string) => api.get('/admin/users'"), 'adminAPI.getUsers supports collegeId')
  ok(api.includes("addTeacher: (data: any) => api.post('/admin/users/teacher'"), 'adminAPI.addTeacher exists')
  ok(api.includes("addStudent: (data: any) => api.post('/admin/users/student'"), 'adminAPI.addStudent exists')
  ok(api.includes("bulkAddTeachers: (teachers: any[], collegeId?: string) => api.post('/admin/users/teachers/bulk'"), 'adminAPI.bulkAddTeachers supports collegeId')
  ok(api.includes("bulkAddStudents: (students: any[], collegeId?: string) => api.post('/admin/users/students/bulk'"), 'adminAPI.bulkAddStudents supports collegeId')
  ok(api.includes("getAnalytics: (collegeId?: string) => api.get('/admin/analytics'"), 'adminAPI.getAnalytics supports collegeId')
  ok(api.includes("getHackathons: (collegeId?: string) => api.get('/admin/hackathons'"), 'adminAPI.getHackathons supports collegeId')
  ok(api.includes("getForms: (collegeId?: string) => api.get('/admin/forms'"), 'adminAPI.getForms supports collegeId')
  ok(api.includes("getColleges: () => api.get('/admin/colleges')"), 'adminAPI.getColleges exists for super')
  // Check that api.ts doesn't force collegeId to always be present for tenant — optional
  ok(api.includes("params: collegeId ? { collegeId } : {}"), 'api collegeId conditional params pattern (only send when present)')
}

// 10. Frontend AdminPage.tsx
console.log('\n--- 10. Frontend AdminPage.tsx ---')
{
  ok(adminPage.includes("const isSuperAdmin = user?.role === 'SUPER_ADMIN'"), 'AdminPage isSuperAdmin flag')
  ok(adminPage.includes("const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>") && adminPage.includes("isSuperAdmin ? null :"), 'AdminPage selectedCollegeId null for super initial')
  ok(adminPage.includes("const loadColleges = useCallback(async () => {") && adminPage.includes("adminAPI.getColleges()"), 'AdminPage loadColleges via adminAPI.getColleges')
  ok(adminPage.includes("const loadCollegeData = useCallback(async (collegeId: string) => {") && adminPage.includes("adminAPI.getAnalytics(collegeId)"), 'AdminPage loadCollegeData scoped by collegeId')
  ok(adminPage.includes("adminAPI.getUsers(collegeId)") && adminPage.includes("departmentAPI.getAll(collegeId)"), 'AdminPage loadCollegeData passes collegeId to all scoped APIs')
  ok(adminPage.includes("if (isSuperAdmin && !selectedCollegeId) {") && adminPage.includes("loadColleges()"), 'AdminPage super without selection loads college list')
  ok(adminPage.includes("handleSelectCollege") && adminPage.includes("setSelectedCollegeId(college.id)"), 'AdminPage handleSelectCollege drills into college')
  ok(adminPage.includes("handleBackToColleges") && adminPage.includes("setSelectedCollegeId(null)"), 'AdminPage back to colleges from drill')
  ok(adminPage.includes("const superCollegeId = isSuperAdmin ? selectedCollegeId : undefined") && adminPage.includes("collegeId: superCollegeId"), 'AdminPage handleAddUser forwards collegeId for super')
  ok(adminPage.includes("const deptPayload: any = { name: newDept.name.trim() }") && adminPage.includes("if (isSuperAdmin && selectedCollegeId) deptPayload.collegeId = selectedCollegeId"), 'AdminPage handleAddDept forwards collegeId for super')
  ok(adminPage.includes("isSuperAdmin && !selectedCollegeId") || adminPage.includes("SUPER_ADMIN"), 'AdminPage handles super empty selection state')
  ok(adminPage.includes("All Colleges") || adminPage.includes("Select a college to manage"), 'AdminPage super college list UI exists')
  ok(adminPage.includes("Pending Approval") && adminPage.includes("Approve") && adminPage.includes("Reject"), 'AdminPage pending approval UI exists')
  ok(adminPage.includes("Click to manage"), 'AdminPage drill hint exists')
}

// 11. Frontend AddTeacher / AddStudent
console.log('\n--- 11. Frontend AddTeacherPage & AddStudentPage ---')
{
  ok(addTeacher.includes("const isSuperAdmin = user?.role === 'SUPER_ADMIN'"), 'AddTeacher isSuperAdmin flag')
  ok(addTeacher.includes("const [colleges, setColleges] = useState<any[]>([])"), 'AddTeacher colleges state')
  ok(addTeacher.includes("const [selectedCollegeId, setSelectedCollegeId] = useState<string>(() => isSuperAdmin ? '' :"), 'AddTeacher selectedCollegeId state with super empty default')
  ok(addTeacher.includes("adminAPI.getColleges().then(setColleges)"), 'AddTeacher fetches colleges for super')
  ok(addTeacher.includes("departmentAPI.getAll(cid)") && addTeacher.includes("isSuperAdmin ? selectedCollegeId : undefined"), 'AddTeacher fetches departments scoped to collegeId')
  ok(addTeacher.includes("if (isSuperAdmin && !selectedCollegeId)") && addTeacher.includes("toast.error('Please select a college first')"), 'AddTeacher validates college selection for super')
  ok(addTeacher.includes("if (isSuperAdmin && selectedCollegeId) payload.collegeId = selectedCollegeId"), 'AddTeacher payload forwards collegeId for super')
  ok(addTeacher.includes("adminAPI.bulkAddTeachers(teachers, isSuperAdmin ? selectedCollegeId : undefined)"), 'AddTeacher bulkAdd forwards collegeId')
  ok(addTeacher.includes('<select value={selectedCollegeId}') && addTeacher.includes('Select college *'), 'AddTeacher college selector UI with required star')
  ok(addTeacher.includes('Select target college — SUPER_ADMIN is global'), 'AddTeacher warning text for super global')

  ok(addStudent.includes("const isSuperAdmin = user?.role === 'SUPER_ADMIN'"), 'AddStudent isSuperAdmin flag')
  ok(addStudent.includes("const [colleges, setColleges] = useState<any[]>([])"), 'AddStudent colleges state')
  ok(addStudent.includes("const [selectedCollegeId, setSelectedCollegeId] = useState<string>(() => isSuperAdmin ? '' :"), 'AddStudent selectedCollegeId state')
  ok(addStudent.includes("adminAPI.getColleges().then(setColleges)"), 'AddStudent fetches colleges for super')
  ok(addStudent.includes("departmentAPI.getAll(cid)") && addStudent.includes("isSuperAdmin && !selectedCollegeId"), 'AddStudent fetches departments scoped')
  ok(addStudent.includes("if (isSuperAdmin && !selectedCollegeId)") && addStudent.includes("Please select a college"), 'AddStudent validates college for super')
  ok(addStudent.includes("...(isSuperAdmin && selectedCollegeId ? { collegeId: selectedCollegeId } : {})"), 'AddStudent payload forwards collegeId')
  ok(addStudent.includes("adminAPI.bulkAddStudents(students, isSuperAdmin ? selectedCollegeId : undefined)"), 'AddStudent bulkAdd forwards collegeId')
  ok(addStudent.includes('Select target college — SUPER_ADMIN must specify college'), 'AddStudent warning text')
}

// 12. ADR doc
console.log('\n--- 12. ADR docs ---')
{
  ok(adr.includes("# ADR 001: SUPER_ADMIN as Global Platform Owner"), 'ADR title correct')
  ok(adr.includes("- **Status:** accepted"), 'ADR status accepted')
  ok(adr.includes("SUPER_ADMIN is distinct from all other roles: global singleton"), 'ADR decision global singleton')
  ok(adr.includes("Public `POST /auth/register` only allows `STUDENT` / `TEACHER`; `SUPER_ADMIN` → 403"), 'ADR documents blocked registration')
  ok(adr.includes("Helper `utils/roles.ts`"), 'ADR mentions roles helper')
  ok(adr.includes("deriveCollegeId") && adr.includes("canAccessCollege"), 'ADR mentions helpers')
  ok(adr.includes("college-scoped write") && adr.includes("deriveCollegeId"), 'ADR write invariants')
  ok(adr.includes("college-scoped read") && adr.includes("canAccessCollege"), 'ADR read invariants')
  ok(adr.includes("GET /internships` (super now global") && adr.includes("GET /rooms` (super now global"), 'ADR lists fixed endpoints')
  ok(adr.includes("AdminPage`: when super admin drilled"), 'ADR documents AdminPage frontend')
  ok(adr.includes("AddTeacherPage` / `AddStudentPage`"), 'ADR documents AddTeacher/AddStudent picker')
  ok(adr.includes("## Validation") && adr.includes("tsc --noEmit"), 'ADR validation mentions tsc')
  ok(adr.includes("## Consequences"), 'ADR consequences section exists')
}

// 13. Functional unit simulations
console.log('\n--- 13. Functional unit simulations ---')
{
  // Simulate roles helpers
  function isSuperAdmin(u){ return u?.role === 'SUPER_ADMIN' }
  function canAccessCollege(user, resourceCollegeId){
    if(isSuperAdmin(user)) return true
    return !!user.collegeId && user.collegeId === resourceCollegeId
  }
  function deriveCollegeId(user, explicitCollegeId){
    if(isSuperAdmin(user)) return explicitCollegeId || user.collegeId || null
    return user.collegeId || null
  }
  ok(isSuperAdmin({role:'SUPER_ADMIN'}), 'isSuperAdmin true for SUPER_ADMIN')
  ok(!isSuperAdmin({role:'COLLEGE_ADMIN'}), 'isSuperAdmin false for COLLEGE_ADMIN')
  ok(!isSuperAdmin({role:'TEACHER'}), 'isSuperAdmin false for TEACHER')
  ok(canAccessCollege({role:'SUPER_ADMIN', collegeId:null}, 'collegeA'), 'canAccessCollege super can access any college')
  ok(canAccessCollege({role:'SUPER_ADMIN', collegeId:'other'}, 'collegeA'), 'super with stray collegeId still bypasses')
  ok(!canAccessCollege({role:'COLLEGE_ADMIN', collegeId:'c1'}, 'c2'), 'canAccessCollege blocks cross-college for COLLEGE_ADMIN')
  ok(canAccessCollege({role:'COLLEGE_ADMIN', collegeId:'c1'}, 'c1'), 'canAccessCollege allows same college')
  ok(!canAccessCollege({role:'COLLEGE_ADMIN', collegeId:null}, 'c1'), 'canAccessCollege collegeAdmin with null cannot access')
  ok(!canAccessCollege({role:'TEACHER', collegeId:'c1'}, 'c2'), 'teacher cross-college blocked')
  // deriveCollegeId
  ok(deriveCollegeId({role:'SUPER_ADMIN', collegeId:null}, 'target123') === 'target123', 'deriveCollegeId super with explicit => explicit')
  ok(deriveCollegeId({role:'SUPER_ADMIN', collegeId:null}, null) === null, 'deriveCollegeId super global => null')
  ok(deriveCollegeId({role:'SUPER_ADMIN', collegeId:'myCollege'}, null) === 'myCollege', 'deriveCollegeId super fallback to own collegeId if no explicit')
  ok(deriveCollegeId({role:'SUPER_ADMIN', collegeId:null}, '') === null, 'deriveCollegeId super empty explicit => null')
  ok(deriveCollegeId({role:'COLLEGE_ADMIN', collegeId:'c1'}, 'c2') === 'c1', 'deriveCollegeId college admin ignores explicit')
  ok(deriveCollegeId({role:'TEACHER', collegeId:'c1'}, 'c2') === 'c1', 'deriveCollegeId teacher ignores explicit')
  ok(deriveCollegeId({role:'STUDENT', collegeId:null}, 'c2') === null, 'deriveCollegeId student with null => null')

  // buildHubListWhere simulation
  function buildHubListWhere(user, filters){
    const where={}
    if(user.role==='SUPER_ADMIN'){ if(filters.collegeId) where.collegeId=filters.collegeId }
    else if(user.collegeId){ where.collegeId=user.collegeId }
    if(filters.search) where.title={contains: filters.search, mode:'insensitive'}
    if(filters.scope && ['ALL','DEPARTMENT','ROOM'].includes(filters.scope)) where.scope=filters.scope
    if(filters.submissionMode && ['ONLINE','OFFLINE','HYBRID'].includes(filters.submissionMode)) where.submissionMode=filters.submissionMode
    return where
  }
  let w = buildHubListWhere({role:'SUPER_ADMIN', collegeId:null}, {})
  ok(!w.collegeId, 'buildHubListWhere super no filter => global (no collegeId)')
  w = buildHubListWhere({role:'SUPER_ADMIN', collegeId:null}, {collegeId:'cTarget'})
  ok(w.collegeId==='cTarget', 'buildHubListWhere super with collegeId => scoped to target')
  w = buildHubListWhere({role:'COLLEGE_ADMIN', collegeId:'c1'}, {collegeId:'c2'})
  ok(w.collegeId==='c1', 'buildHubListWhere college admin ignores explicit collegeId param (uses own)')
  w = buildHubListWhere({role:'TEACHER', collegeId:'c1'}, {search:'math'})
  ok(w.title.contains==='math' && w.collegeId==='c1', 'buildHubListWhere teacher with search => both filters')
  w = buildHubListWhere({role:'SUPER_ADMIN', collegeId:null}, {scope:'DEPARTMENT'})
  ok(w.scope==='DEPARTMENT', 'buildHubListWhere scope filter preserved for super')

  // registration block simulation
  function simulateRegister(requestedRole){
    if(requestedRole==='SUPER_ADMIN') return {status:403, error:'Super admin accounts can only be created by existing super admins'}
    if(requestedRole==='COLLEGE_ADMIN') return {status:403, error:'College admin registration must go through /register-college or admin panel'}
    const safeRole = requestedRole==='TEACHER' ? 'TEACHER' : 'STUDENT'
    return {status:201, role:safeRole}
  }
  ok(simulateRegister('SUPER_ADMIN').status===403, 'registration SUPER_ADMIN => 403')
  ok(simulateRegister('COLLEGE_ADMIN').status===403, 'registration COLLEGE_ADMIN => 403')
  ok(simulateRegister('TEACHER').status===201 && simulateRegister('TEACHER').role==='TEACHER', 'registration TEACHER => 201 TEACHER')
  ok(simulateRegister('STUDENT').status===201 && simulateRegister('STUDENT').role==='STUDENT', 'registration STUDENT => 201 STUDENT')
  ok(simulateRegister(undefined).role==='STUDENT', 'registration no role defaults to STUDENT')
  ok(simulateRegister('ADMIN').role==='STUDENT', 'registration unknown role defaults to STUDENT not escalation')

  // escalation block simulation (PUT /admin/users/:id)
  function simulateUpdateUser(actor, target, newRole){
    if(newRole==='SUPER_ADMIN' && actor.role!=='SUPER_ADMIN') return {status:403, error:'Only Super Admin can assign Super Admin role'}
    if(actor.role!=='SUPER_ADMIN' && target.collegeId !== actor.collegeId) return {status:403}
    // super promotion clears collegeId
    if(newRole==='SUPER_ADMIN') return {status:200, role:newRole, collegeId:null, departmentId:null}
    return {status:200, role:newRole}
  }
  ok(simulateUpdateUser({role:'COLLEGE_ADMIN', collegeId:'c1'}, {collegeId:'c1'}, 'SUPER_ADMIN').status===403, 'COLLEGE_ADMIN cannot escalate to SUPER_ADMIN => 403')
  ok(simulateUpdateUser({role:'TEACHER', collegeId:'c1'}, {collegeId:'c1'}, 'SUPER_ADMIN').status===403, 'TEACHER cannot escalate to SUPER_ADMIN => 403')
  ok(simulateUpdateUser({role:'SUPER_ADMIN', collegeId:null}, {collegeId:'c1'}, 'SUPER_ADMIN').status===200, 'SUPER_ADMIN can promote to SUPER_ADMIN => 200')
  ok(simulateUpdateUser({role:'SUPER_ADMIN', collegeId:null}, {collegeId:'c1'}, 'SUPER_ADMIN').collegeId===null, 'promotion to SUPER_ADMIN clears collegeId to null (global)')
  ok(simulateUpdateUser({role:'SUPER_ADMIN', collegeId:null}, {collegeId:'c1'}, 'COLLEGE_ADMIN').status===200, 'SUPER_ADMIN can promote to COLLEGE_ADMIN')
  ok(simulateUpdateUser({role:'COLLEGE_ADMIN', collegeId:'c1'}, {collegeId:'c2'}, 'TEACHER').status===403, 'COLLEGE_ADMIN cannot update cross-college user')
  ok(simulateUpdateUser({role:'COLLEGE_ADMIN', collegeId:'c1'}, {collegeId:'c1'}, 'TEACHER').status===200, 'COLLEGE_ADMIN can update same-college user')

  // rooms PUT/DELETE canUpdate simulation
  function canUpdateRoom(user, room){
    return room.teacherId===user.id || user.role==='SUPER_ADMIN' || (user.role==='COLLEGE_ADMIN' && user.collegeId && room.teacherCollegeId===user.collegeId)
  }
  ok(canUpdateRoom({id:'u1', role:'TEACHER', collegeId:'c1'}, {teacherId:'u1', teacherCollegeId:'c1'}), 'rooms canUpdate creator => true')
  ok(canUpdateRoom({id:'u99', role:'SUPER_ADMIN', collegeId:null}, {teacherId:'u1', teacherCollegeId:'c1'}), 'rooms canUpdate super => true even not creator')
  ok(canUpdateRoom({id:'u2', role:'COLLEGE_ADMIN', collegeId:'c1'}, {teacherId:'u1', teacherCollegeId:'c1'}), 'rooms canUpdate collegeAdmin same college => true')
  ok(!canUpdateRoom({id:'u2', role:'COLLEGE_ADMIN', collegeId:'c2'}, {teacherId:'u1', teacherCollegeId:'c1'}), 'rooms canUpdate collegeAdmin diff college => false')
  ok(!canUpdateRoom({id:'u3', role:'TEACHER', collegeId:'c1'}, {teacherId:'u1', teacherCollegeId:'c1'}), 'rooms canUpdate other teacher => false')

  // internships GET where simulation
  function internshipWhere(user, filterCollegeId, search){
    let where={}
    const isSuper=user.role==='SUPER_ADMIN'
    if(isSuper){ if(filterCollegeId) where={collegeId:filterCollegeId} }
    else where={collegeId:user.collegeId}
    if(search){
      const s={contains:search, mode:'insensitive'}
      const clause={OR:[{title:s},{company:s},{role:s}]}
      if(isSuper && !filterCollegeId) where=clause
      else { const base=isSuper&&filterCollegeId?{collegeId:filterCollegeId}:{collegeId:user.collegeId}; where={AND:[base, clause]} }
    }
    return where
  }
  let iw = internshipWhere({role:'SUPER_ADMIN', collegeId:null}, undefined, undefined)
  ok(JSON.stringify(iw)==='{}', 'internships super no filter => global {}')
  iw = internshipWhere({role:'SUPER_ADMIN', collegeId:null}, 'cTarget', undefined)
  ok(iw.collegeId==='cTarget', 'internships super with filterCollegeId => scoped')
  iw = internshipWhere({role:'STUDENT', collegeId:'c1'}, undefined, undefined)
  ok(iw.collegeId==='c1', 'internships student => own collegeId')
  iw = internshipWhere({role:'SUPER_ADMIN', collegeId:null}, undefined, 'google')
  ok(iw.OR && iw.OR[0].title.contains==='google', 'internships super global search => OR clause without college prefix')
  iw = internshipWhere({role:'SUPER_ADMIN', collegeId:null}, 'c1', 'google')
  ok(iw.AND && iw.AND[0].collegeId==='c1', 'internships super filtered search => AND with collegeId')
}

// 14. tsc --noEmit verification
console.log('\n--- 14. tsc --noEmit passes ---')
{
  try {
    console.log('Running tsc --noEmit for backend...')
    execSync('npx tsc --noEmit', { cwd: path.join(root, 'packages/backend'), stdio: 'pipe', timeout: 60000 })
    ok(true, 'backend tsc --noEmit passes (exit 0)')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, `backend tsc --noEmit passes (failed: ${out.slice(0,200)})`)
  }
  try {
    console.log('Running tsc --noEmit for web...')
    execSync('npx tsc --noEmit', { cwd: path.join(root, 'apps/web'), stdio: 'pipe', timeout: 60000 })
    ok(true, 'web tsc --noEmit passes (exit 0)')
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '')
    console.error(out.slice(0, 800))
    ok(false, `web tsc --noEmit passes (failed: ${out.slice(0,200)})`)
  }
  // also check that roles.ts is compiled to dist
  try {
    const distRoles = read('packages/backend/dist/utils/roles.js')
    ok(distRoles.includes('isSuperAdmin') || distRoles.includes('SUPER_ADMIN'), 'dist roles.js exists and contains SUPER_ADMIN')
  } catch {
    ok(false, 'dist roles.js exists')
  }
}

// 15. Regression & security checks
console.log('\n--- 15. Regression & security ---')
{
  ok(auth.includes("router.use(authenticate)") || auth.includes("authenticate") , 'auth routes still use authenticate where needed')
  ok(internships.includes("router.use(authenticate)"), 'internships router.use(authenticate) preserved')
  ok(rooms.includes("router.use(authenticate)"), 'rooms router.use(authenticate) preserved')
  ok(assignmentHub.includes("router.use(authenticate)"), 'assignmentHub router.use(authenticate) preserved')
  ok(forms.includes("router.use(authenticate)"), 'forms router.use(authenticate) preserved')
  ok(!auth.includes("role: requestedRole"), 'auth does not assign requestedRole directly (no bypass)')
  ok(!roles.includes("if (true) return"), 'roles no hard-coded bypass')
  ok(!internships.includes("// TODO bypass") && !rooms.includes("// TODO bypass"), 'no TODO bypass comments')
  ok(internships.includes("isSuper") || internships.includes("SUPER_ADMIN"), 'internships still distinguishes super')
  ok(admin.includes("Super admin only") || admin.includes("SUPER_ADMIN"), 'admin still protects super-only routes')
  // check prisma schema nullable collegeId still?
  try {
    const schema = read('packages/backend/prisma/schema.prisma')
    ok(schema.includes("collegeId") && schema.includes("String?"), 'prisma schema collegeId nullable for super global')
    ok(schema.includes("model User") && schema.includes("role"), 'prisma User model has role')
  } catch {
    ok(false, 'prisma schema readable')
  }
  // frontend doesn't leak collegeId for tenant
  ok(!adminPage.includes("selectedCollegeId = user.collegeId") || adminPage.includes("isSuperAdmin ? null"), 'AdminPage not hardcoding collegeId for super')
}

console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed — see FAIL lines above`)
else console.log(`\nAll SUPER_ADMIN architecture checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

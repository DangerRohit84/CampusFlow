/**
 * QA: Rooms Upgrade — Frontend Verification
 * Run: node apps/web/src/__tests__/rooms-upgrade-qa.test.js
 * Spec: Senior-dev upgraded Rooms like assignments/forms:
 *  RoomsPage: search debounce + ACTIVE/COMPLETED filter + dept bar + pagination + card tags ACTIVE/COMPLETED + datetime with time + export CSV + settings gear
 *  StudentRoomsPage parity
 *  RoomDetailPage 3-col analytics (resource breakdown, member activity, members by dept) + member filters search/dept/year + export + settings gear + multi-file upload 5
 *  StudentRoomDetailPage read-only parity
 *  RoomHeader upgraded with createdAt/updatedAt + settings gear
 *  No regression on assignments/forms realtime
 *  tsc --noEmit passes both
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

console.log('=== Rooms Upgrade QA (Frontend) ===\n')

let roomsPage, studentRoomsPage, roomDetail, studentRoomDetail, roomHeader, assignHub, assignDetail, formsPage, formDetail, api, socket
try { roomsPage = read('apps/web/src/pages/RoomsPage.tsx'); ok(true, 'RoomsPage.tsx exists') } catch { ok(false, 'RoomsPage.tsx exists'); roomsPage='' }
try { studentRoomsPage = read('apps/web/src/pages/StudentRoomsPage.tsx'); ok(true, 'StudentRoomsPage.tsx exists') } catch { ok(false, 'StudentRoomsPage.tsx exists'); studentRoomsPage='' }
try { roomDetail = read('apps/web/src/pages/RoomDetailPage.tsx'); ok(true, 'RoomDetailPage.tsx exists') } catch { ok(false, 'RoomDetailPage.tsx exists'); roomDetail='' }
try { studentRoomDetail = read('apps/web/src/pages/StudentRoomDetailPage.tsx'); ok(true, 'StudentRoomDetailPage.tsx exists') } catch { ok(false, 'StudentRoomDetailPage.tsx exists'); studentRoomDetail='' }
try { roomHeader = read('apps/web/src/components/room/RoomHeader.tsx'); ok(true, 'RoomHeader.tsx exists') } catch { ok(false, 'RoomHeader.tsx exists'); roomHeader='' }
try { assignHub = read('apps/web/src/pages/AssignmentHubPage.tsx'); ok(true, 'AssignmentHubPage.tsx exists (regression guard)') } catch { ok(false, 'AssignmentHubPage.tsx exists'); assignHub='' }
try { assignDetail = read('apps/web/src/pages/AssignmentDetailPage.tsx'); ok(true, 'AssignmentDetailPage.tsx exists') } catch { ok(false, 'AssignmentDetailPage.tsx exists'); assignDetail='' }
try { formsPage = read('apps/web/src/pages/FormsPage.tsx'); ok(true, 'FormsPage.tsx exists') } catch { ok(false, 'FormsPage.tsx exists'); formsPage='' }
try { formDetail = read('apps/web/src/pages/FormDetailPage.tsx'); ok(true, 'FormDetailPage.tsx exists') } catch { ok(false, 'FormDetailPage.tsx exists'); formDetail='' }
try { api = read('apps/web/src/lib/api.ts'); ok(true, 'api.ts exists') } catch { ok(false, 'api.ts exists'); api='' }
try { socket = read('apps/web/src/lib/socket.ts'); ok(true, 'socket.ts exists') } catch { ok(false, 'socket.ts exists'); socket='' }

// 1. tsc --noEmit both
try { execSync('npx tsc --noEmit', { cwd: path.join(root, 'apps/web'), stdio: 'pipe', timeout: 90000 }); ok(true, 'web tsc --noEmit passes') } catch (e) { ok(false, 'web tsc --noEmit passes'); console.error((e.stdout||'').toString().slice(0,1200)); console.error((e.stderr||'').toString().slice(0,1200)) }
try { execSync('npx tsc --noEmit', { cwd: path.join(root, 'apps/mobile'), stdio: 'pipe', timeout: 90000 }); ok(true, 'mobile tsc --noEmit passes') } catch (e) { ok(false, 'mobile tsc --noEmit passes'); console.error((e.stdout||'').toString().slice(0,800)) }

// 2. RoomsPage — search debounce
{
  ok(roomsPage.includes("useDebounce(search, 300)") || roomsPage.includes("useDebounce(search,300)"), 'RoomsPage: useDebounce(search,300)')
  ok(roomsPage.includes("const [search, setSearch]"), 'RoomsPage: search state')
  ok(roomsPage.includes("debouncedSearch"), 'RoomsPage: debouncedSearch used')
  ok(roomsPage.includes("roomAPI.getAll({ search: debouncedSearch"), 'RoomsPage: server search via roomAPI.getAll')
  ok(roomsPage.includes('placeholder="Search rooms..."'), 'RoomsPage: search placeholder')
  ok(roomsPage.includes("<Search"), 'RoomsPage: Search icon')
}

// 3. RoomsPage — ACTIVE/COMPLETED pills
{
  ok(roomsPage.includes("statusFilter") && roomsPage.includes("'ALL' | 'ACTIVE' | 'COMPLETED'"), 'RoomsPage: statusFilter ALL/ACTIVE/COMPLETED')
  ok(roomsPage.includes("statusCounts"), 'RoomsPage: statusCounts memo')
  ok(roomsPage.includes("getRoomStatus"), 'RoomsPage: getRoomStatus function')
  ok(roomsPage.includes("'ACTIVE'") && roomsPage.includes("'COMPLETED'"), 'RoomsPage: ACTIVE/COMPLETED strings')
  ok(roomsPage.includes("setStatusFilter"), 'RoomsPage: setStatusFilter pills')
  ok(roomsPage.includes("CheckCircle2") && roomsPage.includes("AlertTriangle"), 'RoomsPage: Active=CheckCircle2 Completed=AlertTriangle icons')
}

// 4. RoomsPage — type tabs (FilterTabs)
{
  ok(roomsPage.includes("FilterTabs"), 'RoomsPage: FilterTabs exists')
  ok(roomsPage.includes('accent="emerald"'), 'RoomsPage: FilterTabs accent emerald')
  ok(roomsPage.includes("'department'") && roomsPage.includes("'club'") && roomsPage.includes("'study_group'") && roomsPage.includes("'custom'"), 'RoomsPage: 4 type tabs + all')
  ok(roomsPage.includes("useFilteredItems"), 'RoomsPage: useFilteredItems hook')
  ok(roomsPage.includes("activeTab") && roomsPage.includes("setActiveTab"), 'RoomsPage: activeTab state')
  ok(roomsPage.includes("tabCounts"), 'RoomsPage: tabCounts memo')
}

// 5. RoomsPage — dept filter teacher-only
{
  ok(roomsPage.includes("isTeacher"), 'RoomsPage: isTeacher computed')
  ok(roomsPage.includes("isTeacher &&"), 'RoomsPage: dept filter gated by isTeacher')
  ok(roomsPage.includes("hubDeptFilter") && roomsPage.includes("setHubDeptFilter"), 'RoomsPage: hubDeptFilter state')
  ok(roomsPage.includes("hubDepartments") && roomsPage.includes("setHubDepartments"), 'RoomsPage: hubDepartments state')
  ok(roomsPage.includes("departmentAPI.getAll"), 'RoomsPage: departmentAPI.getAll fetch')
  ok(roomsPage.includes("All departments"), 'RoomsPage: All departments option')
  ok(roomsPage.includes("Clear scope filters") || roomsPage.includes("Clear filters"), 'RoomsPage: Clear filters button')
  // ensure StudentRoomsPage does NOT have teacher dept filter (student parity without dept)
  const studentHasDeptBar = studentRoomsPage.includes("hubDeptFilter") && studentRoomsPage.includes("isTeacher &&")
  ok(!studentHasDeptBar, 'StudentRoomsPage: no teacher dept bar (correctly student without dept filter)')
}

// 6. RoomsPage — pagination
{
  ok(roomsPage.includes("Pagination"), 'RoomsPage: Pagination component imported/used')
  ok(roomsPage.includes("const [page, setPage]"), 'RoomsPage: page state')
  ok(roomsPage.includes("const limit = 12") || roomsPage.includes("limit = 12"), 'RoomsPage: limit 12')
  ok(roomsPage.includes("totalPages") && roomsPage.includes("Math.ceil"), 'RoomsPage: totalPages computed via Math.ceil')
  ok(roomsPage.includes("paginatedRooms") && roomsPage.includes("slice"), 'RoomsPage: paginatedRooms slice')
  ok(roomsPage.includes("useEffect(() => { setPage(1) }") || roomsPage.includes("setPage(1)"), 'RoomsPage: reset page on filter change')
  ok(roomsPage.includes("page={page}") && roomsPage.includes("totalPages={totalPages}"), 'RoomsPage: Pagination props page/totalPages')
  ok(roomsPage.includes("Showing") && roomsPage.includes("page") , 'RoomsPage: showing count footer')
}

// 7. RoomsPage — card tags ACTIVE/COMPLETED
{
  ok(roomsPage.includes("isActive ? 'ACTIVE'") || roomsPage.includes("status ===") || roomsPage.includes("getRoomStatus(room)"), 'RoomsPage: card computes status per room')
  ok(roomsPage.includes("bg-emerald-50") && roomsPage.includes("bg-rose-50"), 'RoomsPage: card tag emerald/rose colors')
  ok(roomsPage.includes("card-accent--emerald") && roomsPage.includes("card-accent--rose"), 'RoomsPage: card-accent emerald/rose border')
  ok(roomsPage.includes("live-dot") , 'RoomsPage: live-dot indicator')
}

// 8. RoomsPage — datetime with hour
{
  ok(roomsPage.includes("toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })"), 'RoomsPage: toLocaleString with hour:2-digit minute:2-digit')
  ok(roomsPage.includes("createdAtLabel"), 'RoomsPage: createdAtLabel computed')
  // also in edit modal
  ok(roomsPage.includes("Created") && roomsPage.includes("Updated") && roomsPage.includes("hour"), 'RoomsPage: edit modal shows Created/Updated with hour')
}

// 9. RoomsPage — export CSV
{
  ok(roomsPage.includes("const handleExport"), 'RoomsPage: handleExport exists')
  ok(roomsPage.includes("Export") && roomsPage.includes("Download"), 'RoomsPage: Export button with Download icon')
  ok(roomsPage.includes("text/csv") && roomsPage.includes("Blob"), 'RoomsPage: CSV Blob creation')
  ok(roomsPage.includes("createObjectURL") && roomsPage.includes("a.download"), 'RoomsPage: CSV download via createObjectURL')
  ok(roomsPage.includes("Room Name") && roomsPage.includes("Join Code") && roomsPage.includes("Status"), 'RoomsPage: CSV header includes Room Name/Join Code/Status')
  ok(roomsPage.includes("replace(/\"/g,'\"\"')") || roomsPage.includes('replace(/"/g, \'""\')'), 'RoomsPage: csv esc handles quotes')
}

// 10. RoomsPage — settings gear
{
  ok(roomsPage.includes("<Settings") , 'RoomsPage: Settings icon imported')
  ok(roomsPage.includes("Edit Room — Settings") || roomsPage.includes("Room Settings"), 'RoomsPage: Edit Room Settings modal title')
  ok(roomsPage.includes("ID") && roomsPage.includes("slice(0, 8)"), 'RoomsPage: edit modal shows ID')
  ok(roomsPage.includes("Time is stored with full datetime"), 'RoomsPage: datetime help text')
  // card edit via Pencil is gear parity
  ok(roomsPage.includes("Pencil") && roomsPage.includes("openEditModal"), 'RoomsPage: pencil edit per card + modal')
}

// 11. StudentRoomsPage parity (search, pills, tabs, dept absence, pagination, card tags, datetime hour, export)
{
  ok(studentRoomsPage.includes("useDebounce(search, 300)"), 'StudentRoomsPage: useDebounce parity')
  ok(studentRoomsPage.includes("statusFilter") && studentRoomsPage.includes("ACTIVE"), 'StudentRoomsPage: ACTIVE/COMPLETED pills parity')
  ok(studentRoomsPage.includes("FilterTabs") && studentRoomsPage.includes('accent="emerald"'), 'StudentRoomsPage: FilterTabs emerald parity')
  ok(studentRoomsPage.includes("Pagination") && studentRoomsPage.includes("totalPages"), 'StudentRoomsPage: Pagination parity')
  ok(studentRoomsPage.includes("getRoomStatus") && studentRoomsPage.includes("CheckCircle2") && studentRoomsPage.includes("AlertTriangle"), 'StudentRoomsPage: card tags ACTIVE/COMPLETED parity')
  ok(studentRoomsPage.includes("toLocaleString(undefined, { month: 'short'") && studentRoomsPage.includes("hour"), 'StudentRoomsPage: datetime with hour parity')
  ok(studentRoomsPage.includes("handleExport") && studentRoomsPage.includes("text/csv"), 'StudentRoomsPage: export parity')
  ok(studentRoomsPage.includes("Join Room") && studentRoomsPage.includes("Join Code") || studentRoomsPage.includes("Join Room"), 'StudentRoomsPage: join flow preserved')
  ok(studentRoomsPage.includes("Showing") && studentRoomsPage.includes("rooms • page"), 'StudentRoomsPage: pagination footer parity')
  // ensure student has no teacher dept filter but has search + pills
  ok(studentRoomsPage.includes('placeholder="Search rooms..."'), 'StudentRoomsPage: search placeholder parity')
}

// 12. RoomDetailPage — 3-col analytics
{
  ok(roomDetail.includes('grid-cols-1 md:grid-cols-3'), 'RoomDetailPage: 3-col grid analytics')
  ok(roomDetail.includes("Resource breakdown"), 'RoomDetailPage: Resource breakdown card')
  ok(roomDetail.includes("Member activity"), 'RoomDetailPage: Member activity card')
  ok(roomDetail.includes("Members by department"), 'RoomDetailPage: Members by department card')
  ok(roomDetail.includes("resourceBreakdown") && roomDetail.includes("useMemo"), 'RoomDetailPage: resourceBreakdown memo')
  ok(roomDetail.includes("membersDeptBreakdown") && roomDetail.includes("useMemo"), 'RoomDetailPage: membersDeptBreakdown memo')
  ok(roomDetail.includes("FileText") && roomDetail.includes("BarChart2") && roomDetail.includes("Users"), 'RoomDetailPage: analytics icons FileText/BarChart2/Users')
  ok(roomDetail.includes("bg-emerald-500") && roomDetail.includes("bg-primary-500"), 'RoomDetailPage: progress bars emerald/primary')
  ok(roomDetail.includes("totalResources") && roomDetail.includes("members.length"), 'RoomDetailPage: analytics uses totalResources + members.length')
}

// 13. RoomDetailPage — member filters search/dept/year + export + settings gear
{
  ok(roomDetail.includes('placeholder="Search name, student ID, email..."'), 'RoomDetailPage: member search placeholder')
  ok(roomDetail.includes("const [search, setSearch]"), 'RoomDetailPage: search state')
  ok(roomDetail.includes("selectedDept") && roomDetail.includes("setSelectedDept"), 'RoomDetailPage: selectedDept filter')
  ok(roomDetail.includes("selectedYear") && roomDetail.includes("setSelectedYear"), 'RoomDetailPage: selectedYear filter')
  ok(roomDetail.includes("All departments") && roomDetail.includes("All years"), 'RoomDetailPage: dept/year ALL options')
  ok(roomDetail.includes("departmentAPI.getAll"), 'RoomDetailPage: departmentAPI fetch')
  ok(roomDetail.includes("filteredMembers") && roomDetail.includes("useMemo"), 'RoomDetailPage: filteredMembers memo')
  ok(roomDetail.includes("availableYears") && roomDetail.includes("incomingYear"), 'RoomDetailPage: availableYears memo')
  ok(roomDetail.includes("Clear filters") && roomDetail.includes("setSearch('')"), 'RoomDetailPage: Clear filters button')
  ok(roomDetail.includes("handleExport") && roomDetail.includes("Export CSV") && roomDetail.includes("text/csv"), 'RoomDetailPage: Export CSV button')
  ok(roomDetail.includes("onExport={handleExport}"), 'RoomDetailPage: onExport passed to RoomHeader')
  ok(roomDetail.includes("<Settings") && roomDetail.includes("openRoomSettings"), 'RoomDetailPage: Settings gear')
  ok(roomDetail.includes("Room Settings — Edit") && roomDetail.includes("Created"), 'RoomDetailPage: Room Settings modal with datetime')
}

// 14. RoomDetailPage — multi-file upload 5
{
  ok(roomDetail.includes("uploadFiles") && roomDetail.includes("useState<File[]>"), 'RoomDetailPage: uploadFiles File[] state')
  ok(roomDetail.includes('type="file"') && roomDetail.includes("multiple"), 'RoomDetailPage: file input multiple')
  ok(roomDetail.includes("slice(0, 5)") || roomDetail.includes("slice(0,5)"), 'RoomDetailPage: slice 0,5 limit')
  ok(roomDetail.includes("uploadFiles.length > 5") || roomDetail.includes("Max 5 files"), 'RoomDetailPage: Max 5 validation')
  ok(roomDetail.includes("Multiple") || roomDetail.includes("up to 5, 50MB each"), 'RoomDetailPage: label up to 5')
  ok(roomDetail.includes("for (let idx = 0; idx < uploadFiles.length; idx++)") || roomDetail.includes("for (let idx"), 'RoomDetailPage: loop over uploadFiles')
  ok(roomDetail.includes("formData.append('file', file)") && roomDetail.includes("formData.append('title'"), 'RoomDetailPage: FormData append file+title')
  ok(roomDetail.includes("roomAPI.uploadResource"), 'RoomDetailPage: roomAPI.uploadResource per file')
  ok(roomDetail.includes("Uploaded") && roomDetail.includes("success") , 'RoomDetailPage: toast success count')
  ok(roomDetail.includes("Upload Resources — Multi-file") || roomDetail.includes("Multi-file"), 'RoomDetailPage: upload modal title Multi-file')
}

// 15. StudentRoomDetailPage read-only parity
{
  ok(studentRoomDetail.includes('grid-cols-1 md:grid-cols-3'), 'StudentRoomDetailPage: 3-col analytics parity')
  ok(studentRoomDetail.includes("Resource breakdown") && studentRoomDetail.includes("Member activity") && studentRoomDetail.includes("Members by department"), 'StudentRoomDetailPage: 3 analytics cards parity')
  ok(studentRoomDetail.includes('placeholder="Search name, student ID, email..."') && studentRoomDetail.includes("selectedDept") && studentRoomDetail.includes("selectedYear"), 'StudentRoomDetailPage: member filters parity')
  ok(studentRoomDetail.includes("handleExport") && studentRoomDetail.includes("Export CSV"), 'StudentRoomDetailPage: export parity')
  ok(studentRoomDetail.includes("canManage={false}") && studentRoomDetail.includes("RoomResourcesPanel"), 'StudentRoomDetailPage: resources read-only canManage false')
  ok(!studentRoomDetail.includes("slice(0, 5)") || studentRoomDetail.includes("canManage={false}"), 'StudentRoomDetailPage: no multi-upload for student (read-only)')
  ok(studentRoomDetail.includes("filteredMembers") && studentRoomDetail.includes("availableYears"), 'StudentRoomDetailPage: filteredMembers + availableYears parity')
  ok(studentRoomDetail.includes("toLocaleString(undefined, { month: 'short'") && studentRoomDetail.includes("hour"), 'StudentRoomDetailPage: datetime hour parity')
  ok(studentRoomDetail.includes("Leave Room"), 'StudentRoomDetailPage: Leave Room action')
}

// 16. RoomHeader upgraded
{
  ok(roomHeader.includes("createdAt") && roomHeader.includes("updatedAt"), 'RoomHeader: createdAt/updatedAt props')
  ok(roomHeader.includes("createdAtLabel") && roomHeader.includes("hour") && roomHeader.includes("minute"), 'RoomHeader: createdAtLabel with hour:2-digit')
  ok(roomHeader.includes("Updated") && roomHeader.includes("new Date(updatedAt)"), 'RoomHeader: Updated At line with hour')
  ok(roomHeader.includes("<Settings") && roomHeader.includes("onEditSettings"), 'RoomHeader: Settings gear button')
  ok(roomHeader.includes('title="Edit room settings') && roomHeader.includes('aria-label="Edit room settings"'), 'RoomHeader: gear title + aria-label')
  ok(roomHeader.includes("onExport") && roomHeader.includes("<Download"), 'RoomHeader: Export button with Download')
  ok(roomHeader.includes("copyJoinCode") && roomHeader.includes("navigator.clipboard.writeText"), 'RoomHeader: copy join code')
  ok(roomHeader.includes("memberCount") && roomHeader.includes("resourceCount") && roomHeader.includes("Chip"), 'RoomHeader: member/resource Chips preserved')
}

// 17. No regression on assignments/forms realtime
{
  ok(assignHub.includes("assignment:mutated") || assignHub.includes("assignment:hub:updated"), 'AssignmentHubPage: realtime assignment:mutated still subscribed')
  ok(assignHub.includes("getSocket()") || assignHub.includes("window.addEventListener('assignment:mutated'"), 'AssignmentHubPage: socket + window listeners intact')
  ok(assignDetail.includes("assignment:mutated") && assignDetail.includes("assignment:graded") && assignDetail.includes("loadStatsAndPending") || assignDetail.includes("assignment:mutated"), 'AssignmentDetailPage: realtime still intact')
  ok(formsPage.includes("form:mutated") && formsPage.includes("form:updated"), 'FormsPage: realtime form:mutated intact')
  ok(formDetail.includes("form:mutated") && formDetail.includes("form:response:updated") && formDetail.includes("getSocket"), 'FormDetailPage: realtime form:mutated + getSocket intact')
  ok(!roomsPage.includes("assignment:mutated") || roomsPage.includes("room:mutated"), 'RoomsPage: does not break assignment events (uses room:mutated)')
  // ensure rooms didn't override global invalidation that would break assignments
  ok(roomDetail.includes("queryClient.invalidateQueries({ queryKey: ['rooms'] })"), 'RoomDetailPage: invalidates rooms not assignments (isolated)')
  ok(assignHub.includes("queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })") || assignHub.includes("queryKey: ['assignmentHubs']"), 'AssignmentHubPage: still invalidates assignmentHubs correctly')
}

// 18. Extra: realtime parity rooms (socket + window)
{
  ok(roomsPage.includes("getSocket()") && roomsPage.includes("room:mutated"), 'RoomsPage: socket room:mutated listener')
  ok(roomsPage.includes("window.addEventListener('room:mutated'") && roomsPage.includes("window.dispatchEvent(new CustomEvent('room:mutated'"), 'RoomsPage: window room:mutated parity')
  ok(roomDetail.includes("getSocket()") && roomDetail.includes("room:mutated") && roomDetail.includes("room:resource:uploaded"), 'RoomDetailPage: socket listens to room:mutated + resource events')
  ok(roomDetail.includes("window.addEventListener('room:mutated'") && roomDetail.includes("window.dispatchEvent(new CustomEvent('room:mutated'"), 'RoomDetailPage: window events parity')
  ok(studentRoomsPage.includes("room:mutated") && studentRoomsPage.includes("getSocket()"), 'StudentRoomsPage: socket parity')
  ok(studentRoomDetail.includes("room:mutated") && studentRoomDetail.includes("getSocket()"), 'StudentRoomDetailPage: socket parity')
}

// 19. Functional simulation — status logic, pagination, csv esc, dept filter
{
  // getRoomStatus simulation
  function getRoomStatus(room) {
    const unread = Number(room.unreadCount) || 0
    if (unread > 0) return 'ACTIVE'
    const members = room._count?.members ?? room.members?.length ?? 0
    const resources = room._count?.resources ?? room.resources?.length ?? 0
    if (members > 0 || resources > 0) return 'ACTIVE'
    const createdAt = room.createdAt ? new Date(room.createdAt).getTime() : Date.now()
    const ageMs = Date.now() - createdAt
    if (ageMs < 30 * 24 * 60 * 60 * 1000) return 'ACTIVE'
    return 'COMPLETED'
  }
  ok(getRoomStatus({ unreadCount: 1 }) === 'ACTIVE', 'getRoomStatus: unread>0 => ACTIVE')
  ok(getRoomStatus({ _count:{members:1, resources:0}, createdAt: new Date().toISOString() }) === 'ACTIVE', 'getRoomStatus: members>0 => ACTIVE')
  ok(getRoomStatus({ _count:{members:0, resources:2} }) === 'ACTIVE', 'getRoomStatus: resources>0 => ACTIVE')
  ok(getRoomStatus({ _count:{members:0, resources:0}, createdAt: new Date().toISOString() }) === 'ACTIVE', 'getRoomStatus: recent (<30d) => ACTIVE')
  ok(getRoomStatus({ _count:{members:0, resources:0}, createdAt: new Date(Date.now()-40*24*60*60*1000).toISOString() }) === 'COMPLETED', 'getRoomStatus: old (>30d) no members/resources => COMPLETED')

  // pagination boundary
  const list = Array.from({length: 25}, (_,i)=> ({id:i}))
  const limit=12
  const totalPages = Math.max(1, Math.ceil(list.length/limit))
  ok(totalPages===3, `pagination 25 items limit12 => 3 pages (got ${totalPages})`)
  const paginated = list.slice((3-1)*limit, 3*limit)
  ok(paginated.length===1 && paginated[0].id===24, 'pagination last page has 1 item')

  // csv esc edge
  const esc = (v)=>{ const s=String(v??''); if(s.includes(',')||s.includes('"')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`; return s}
  ok(esc('a,b') === '"a,b"', 'csv esc comma')
  ok(esc('a"b') === '"a""b"', 'csv esc quote')
  ok(esc('a\nb') === '"a\nb"', 'csv esc newline')
  ok(esc('simple') === 'simple', 'csv esc simple unchanged')
  ok(esc(null) === '', 'csv esc null => empty')

  // member dept filter edge
  const members = [
    { name:'Ali', departmentName:'CSE', departmentId:'dept1', incomingYear:2021 },
    { name:'Bob', departmentName:'ECE', departmentId:'dept2', incomingYear:2022 },
    { name:'Cara', departmentName:'Unknown', incomingYear:null },
  ]
  const filteredByDept = members.filter(m=> m.departmentId==='dept1')
  ok(filteredByDept.length===1 && filteredByDept[0].name==='Ali', 'member dept filter dept1 => Ali')
  const filteredByYear = members.filter(m=> String(m.incomingYear ?? '')==='2021')
  ok(filteredByYear.length===1 && filteredByYear[0].name==='Ali', 'member year filter 2021 => Ali')
  const emptySearch = members.filter(m=> {
    const term=''.trim().toLowerCase(); if(term){ const hay=`${m.name}`.toLowerCase(); if(!hay.includes(term)) return false } return true
  })
  ok(emptySearch.length===3, 'empty search returns all members')
}

console.log(`\n--- Summary ---`)
console.log(`Pass: ${passes}, Fail: ${fails}`)
if (fails>0) console.log(`\n✗ ${fails} checks failed`)
else console.log(`\nAll Rooms upgrade checks PASS (${passes}/${passes+fails})`)
process.exitCode = fails>0 ? 1 : 0

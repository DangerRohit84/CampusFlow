/**
 * QA: Superadmin Dashboard Frontend — Smoke
 * Run: node "D:/Alpha Coders/CampusFlow/apps/web/src/__tests__/superadmin-dashboard-qa.test.js"
 * Verifies SuperAdminDashboardPage.tsx + routing + Layout + api + AdminPage regression
 */
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const root = 'D:/Alpha Coders/CampusFlow'
let passes = 0, fails = 0
function ok(cond, label) { if (cond) { passes++; console.log(`PASS | ${label}`) } else { fails++; console.error(`FAIL | ${label}`) } }
function read(p) { return fs.readFileSync(path.join(root, p), 'utf8') }
console.log('=== Frontend Superadmin Dashboard QA ===\n')
let superPage, app, layout, api, adminPage
try { superPage = read('apps/web/src/pages/SuperAdminDashboardPage.tsx'); ok(true, 'SuperAdminDashboardPage.tsx exists') } catch { ok(false, 'SuperAdminDashboardPage.tsx exists'); superPage='' }
try { app = read('apps/web/src/App.tsx'); ok(true, 'App.tsx exists') } catch { ok(false, 'App.tsx exists'); app='' }
try { layout = read('apps/web/src/components/layout/Layout.tsx'); ok(true, 'Layout.tsx exists') } catch { ok(false, 'Layout.tsx exists'); layout='' }
try { api = read('apps/web/src/lib/api.ts'); ok(true, 'api.ts exists') } catch { ok(false, 'api.ts exists'); api='' }
try { adminPage = read('apps/web/src/pages/AdminPage.tsx'); ok(true, 'AdminPage.tsx exists') } catch { ok(false, 'AdminPage.tsx exists'); adminPage='' }

ok(superPage.includes('Super Admin Command Center'), 'header Super Admin Command Center')
ok(superPage.includes('value={collegeId}') && superPage.includes('All Colleges'), 'college dropdown')
ok(superPage.includes('Date range') && superPage.includes('Last 7 days'), 'date range 7d/30d/90d')
ok(superPage.includes('Pending College Queue') && superPage.includes('adminAPI.approveCollege') && superPage.includes('adminAPI.rejectCollege'), 'Pending Queue approve/reject')
ok(superPage.includes('StatCard label="Colleges"') && superPage.includes('StatCard label="Users"') && superPage.includes('kpis?.colleges?.total'), 'KPI StatCards')
ok(superPage.includes('College Distribution') && superPage.includes('style={{ width:'), 'College Distribution bars (Tailwind div % bars)')
ok(superPage.includes('Submission Rate') && superPage.includes('<table'), 'Submission Rate table')
ok(superPage.includes('Recent Assignments') && superPage.includes('Recent Rooms') && superPage.includes('Recent Forms'), 'Recent Activity 3-col')
ok(superPage.includes('Quick Actions') && superPage.includes('Create College'), 'Quick Actions')
ok(superPage.includes('System Health') && superPage.includes('system?.db'), 'System Health')
ok(superPage.includes("staleTime: 15 * 1000") && superPage.includes("gcTime: 60 * 1000"), 'TanStack stale 15s gc 60s')
ok(superPage.includes("window.addEventListener('assignment:mutated'") && superPage.includes("invalidateQueries({ queryKey: ['super-dashboard'] })"), 'socket invalidation')
ok(app.includes('SuperAdminGuard') && app.includes("user?.role !== 'SUPER_ADMIN'") && app.includes('path="superadmin"'), 'routing /superadmin guarded')
ok(layout.includes("SUPER_ADMIN: [") && layout.includes("path: '/superadmin'") && layout.includes("Super Overview"), 'Layout Super Overview')
ok(api.includes('superAdminAPI') && api.includes("api.get('/admin/super/dashboard'"), 'api superAdminAPI.getDashboard')
ok(adminPage.includes("isSuperAdmin = user?.role === 'SUPER_ADMIN'") && adminPage.includes("loadColleges"), 'AdminPage regression intact')
try { execSync('npx tsc --noEmit', { cwd: path.join(root, 'apps/web'), stdio: 'pipe', timeout: 60000 }); ok(true, 'web tsc --noEmit passes') } catch (e) { ok(false, 'web tsc --noEmit passes'); console.error((e.stdout||'').toString().slice(0,300)) }
console.log(`\nPass: ${passes}, Fail: ${fails}`)
process.exitCode = fails>0?1:0

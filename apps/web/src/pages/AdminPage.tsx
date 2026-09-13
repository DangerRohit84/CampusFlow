import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { adminAPI, departmentAPI } from '../lib/api'
import { useAdminBundle, useAdminUsers, useAdminRoleCounts, useAdminColleges } from '../hooks/useAdminQueries'
import { useQueryClient } from '@tanstack/react-query'
import { adminKeys as deprecatedAdminKeys } from '../hooks/useAdminQueries'
void deprecatedAdminKeys; // compat import kept (SSOT is qk.admin.*)
import { qk } from '../lib/queryKeys'
import { logger } from '../lib/logger'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, GraduationCap, Trophy, FileText, Trash2, BarChart3, Shield, CheckCircle, XCircle,
  UserPlus, FolderPlus, ArrowLeft, Building2
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Input from '../components/ui/Input'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSuperAdminCollegeStore, syncLegacyStorage } from '../store/superAdminCollegeStore'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'
import Pagination from '../components/shared/Pagination'
import { useConfirm } from '../components/ui/ConfirmModal'
import BulkImportModal, { type BulkRole } from '../components/admin/BulkImportModal'

// WHY: Users tab pages server-side at 50 (backend take:50+count dual-mode,
// same cursor/page contract as notifications/rooms). Keeps 10k-scale lists correct.
const USERS_PAGE_SIZE = 50
const subTabToRole = (t: 'students' | 'teachers' | 'college_admins') =>
  t === 'students' ? 'STUDENT' : t === 'teachers' ? 'TEACHER' : 'COLLEGE_ADMIN'

export default function AdminPage() {
  const { user } = useAuthStore()
  const { confirm: confirmDialog } = useConfirm()
  const navigate = useNavigate()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isCollegeAdmin = user?.role === 'COLLEGE_ADMIN'

  const [loading, setLoading] = useState(true)
  const [colleges, setColleges] = useState<any[]>([])
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(() => {
    if (isSuperAdmin) {
      // WHY one-click fix: hydrate from ?collegeId/store/localStorage synchronously.
      // Previously always null → /admin?collegeId=xxx showed All Colleges list again (2nd click required).
      try {
        const q = new URLSearchParams(window.location.search).get('collegeId')
        if (q) return q
      } catch {}
      try {
        const cur = useSuperAdminCollegeStore.getState().selectedCollegeId
        if (cur) return String(cur)
      } catch {}
      try {
        const legacy = localStorage.getItem('superadmin_selectedCollegeId')
        if (legacy) return legacy
      } catch {}
      return null
    }
    return (user as any)?.collegeId || null
  })
  const [selectedCollegeName, setSelectedCollegeName] = useState<string>(() => {
    if (isSuperAdmin) {
      try {
        const qn = new URLSearchParams(window.location.search).get('collegeName')
        if (qn) return qn
      } catch {}
      try {
        const cur = useSuperAdminCollegeStore.getState().selectedCollegeName
        if (cur) return String(cur)
      } catch {}
      try {
        const legacy = localStorage.getItem('superadmin_selectedCollegeName')
        if (legacy) return legacy
      } catch {}
      return ''
    }
    return 'My College'
  })

  const [activeTab, setActiveTab] = useState<'analytics' | 'users' | 'departments' | 'content'>(() => {
    // WHY: persist users view in URL (?tab=&role=&dept=&page=) so filtered lists are shareable + survive reload.
    const t = new URLSearchParams(window.location.search).get('tab')
    return t === 'users' || t === 'departments' || t === 'content' ? t : 'analytics'
  })
  const [users, setUsers] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [hackathons, setHackathons] = useState<any[]>([])
  const [forms, setForms] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])

  const [showAddUser, setShowAddUser] = useState(false)
  const [showAddDept, setShowAddDept] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'STUDENT', departmentId: '', studentId: '' })
  const [newDept, setNewDept] = useState({ name: '' })
  const [renamingDept, setRenamingDept] = useState<string | null>(null)
  const [renameDeptName, setRenameDeptName] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [userSubTab, setUserSubTab] = useState<'students' | 'teachers' | 'college_admins'>(() => {
    const r = new URLSearchParams(window.location.search).get('role')
    return r === 'teachers' ? 'teachers' : r === 'college_admins' ? 'college_admins' : 'students'
  })
  // Department filter shared by the students + teachers lists. 'all' = no filter (default).
  const [deptFilter, setDeptFilter] = useState<string>(
    () => new URLSearchParams(window.location.search).get('dept') || 'all'
  )
  // Users pager (server-side page/limit/total, limit 50). ?page= persists in URL;
  // resets to 1 whenever role/dept/college filter changes.
  const [usersPage, setUsersPage] = useState<number>(() => {
    const p = parseInt(new URLSearchParams(window.location.search).get('page') || '1', 10)
    return Number.isFinite(p) && p >= 1 ? p : 1
  })
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersTotalPages, setUsersTotalPages] = useState(1)
  const [roleTotals, setRoleTotals] = useState({ students: 0, teachers: 0, college_admins: 0 })
  const [usersLoading, setUsersLoading] = useState(false)
  const [showAddCollege, setShowAddCollege] = useState(false)
  const [newCollege, setNewCollege] = useState({ name: '', code: '', address: '' })
  // #11 bulk CSV import modal (dry-run → confirm). Role follows the users
  // sub-tab so teachers/students templates + endpoints stay correct.
  const [bulkOpen, setBulkOpen] = useState(false)
  // Track 4 I-10: TanStack Query owns caching (was 4 Maps + 4 AbortControllers
  // + 4 seqs + evictCache duplicating RQ staleTime/gcTime/keepPreviousData).
  // Hooks in useAdminQueries.ts are the canonical data layer (same keys/
  // staleTime/gcTime/signal as the manual cache they replace). RQ owns
  // cancellation via queryFn({signal}); keepPreviousData prevents list flash;
  // refetchOnWindowFocus is OFF globally (queryClient.ts). Local state below
  // is synced from hooks via effects so the 47-page render code is unchanged.
  const queryClient = useQueryClient()
  const effectiveCollegeId =
    selectedCollegeId || ((isCollegeAdmin && (user as unknown as { collegeId?: string })?.collegeId) || null)
  const inCollegeView = !!effectiveCollegeId && !(isSuperAdmin && !selectedCollegeId)
  const collegesEnabled = isSuperAdmin && !selectedCollegeId
  const bundleQuery = useAdminBundle(effectiveCollegeId, inCollegeView)
  const usersRole = subTabToRole(userSubTab)
  const usersQuery = useAdminUsers(
    effectiveCollegeId,
    usersRole,
    deptFilter,
    usersPage,
    USERS_PAGE_SIZE,
    inCollegeView,
  )
  const roleCountsQuery = useAdminRoleCounts(effectiveCollegeId, deptFilter, inCollegeView)
  const collegesQuery = useAdminColleges(collegesEnabled)

  // (Deleted 200-line manual cache: 4 Maps + 4 AbortControllers + 4 seqs +
  // evictCache + prefetchUsersRole duplicating RQ staleTime/gcTime/
  // keepPreviousData. RQ hooks above own caching + cancellation via
  // queryFn({signal}); hover prefetch uses queryClient.prefetchQuery.)

  // Compat: RQ owns ['admin-colleges'] (2min stale). Force busts the cache.
  const loadColleges = useCallback(async (opts?: { force?: boolean }) => {
    try {
      if (opts?.force) await queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
      else await queryClient.refetchQueries({ queryKey: qk.admin.colleges() }, { throwOnError: false } as never).catch((err) => { logger.warn('admin refetch failed (non-fatal)', { err }) })
    } catch (e) {
      logger.error('Failed to load colleges', { error: e })
    }
  }, [queryClient])

  // Compat: RQ owns ['admin', collegeId, 'bundle'] (2min stale, keepPreviousData).
  // Tab switches never refetch (render from RQ cache); college switches hit
  // cache first → instant, background revalidate only when stale.
  const loadCollegeData = useCallback(async (collegeId: string, opts?: { force?: boolean }) => {
    try {
      if (opts?.force) await queryClient.invalidateQueries({ queryKey: qk.admin.bundle(collegeId) })
      else await queryClient.refetchQueries({ queryKey: qk.admin.bundle(collegeId) }, { throwOnError: false } as never).catch((err) => { logger.warn('admin refetch failed (non-fatal)', { err }) })
    } catch (e) {
      logger.error('Failed to load college data', { error: e })
    }
  }, [queryClient])

  // Compat: RQ owns ['admin-users', collegeId, role, dept, page] (60s stale,
  // keepPreviousData). Paging never refetches the bundle (separate query key).
  const loadUsers = useCallback(async (collegeId: string, deptId: string, roleTab: 'students' | 'teachers' | 'college_admins', page: number, opts?: { force?: boolean }) => {
    try {
      const role = subTabToRole(roleTab)
      const dept = deptId ?? 'all'
      if (opts?.force) {
        await queryClient.invalidateQueries({ queryKey: qk.admin.users(collegeId, role, dept, page) })
      } else {
        await queryClient.refetchQueries({ queryKey: qk.admin.users(collegeId, role, dept, page) }, { throwOnError: false } as never).catch((err) => { logger.warn('admin refetch failed (non-fatal)', { err }) })
      }
    } catch (e) {
      logger.error('Failed to load users', { error: e })
    }
  }, [queryClient])

  // Compat: RQ owns ['admin-role-counts', collegeId, dept] via single GROUP BY
  // (was 3× take:1+count round-trips). Badges can never disagree with the list.
  const loadRoleCounts = useCallback(async (collegeId: string, deptId: string, opts?: { force?: boolean }) => {
    try {
      const dept = deptId ?? 'all'
      if (opts?.force) await queryClient.invalidateQueries({ queryKey: qk.admin.roleCounts(collegeId, dept) })
      else await queryClient.refetchQueries({ queryKey: qk.admin.roleCounts(collegeId, dept) }, { throwOnError: false } as never).catch((err) => { logger.warn('admin refetch failed (non-fatal)', { err }) })
    } catch (e) {
      logger.error('Failed to load role counts', { error: e })
    }
  }, [queryClient])


  // STATE-SYNC: external mutations (other tab/device) refresh without reload.
  // RQ auto-fetches on key change (college/role/dept/page); no manual loaders.
  // This effect only clears the full-page loader for the super-admin list view.
  useEntitySync(['user', 'college', 'department'], (() => {
    void queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
    if (effectiveCollegeId) void queryClient.invalidateQueries({ queryKey: qk.admin.bundle(effectiveCollegeId) })
  }) as never)
  useEffect(() => {
    if (isSuperAdmin && !selectedCollegeId) setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollegeId])

  // Track 4 I-10: RQ is the source of truth — sync hook data to local state so
  // the render below (users/analytics/hacks/forms/depts/colleges) is unchanged.
  // keepPreviousData keeps the old list visible while the new page fetches
  // (was manual Map hit + dim "Filtering…" only). Errors go to logger, not console.
  useEffect(() => {
    if (collegesQuery.data) setColleges(collegesQuery.data as unknown as never[])
    if (collegesQuery.error) logger.error('Failed to load colleges', { error: collegesQuery.error })
  }, [collegesQuery.data, collegesQuery.error])
  useEffect(() => {
    const b = bundleQuery.data as
      | { analytics?: unknown; hackathons?: unknown[]; forms?: unknown[]; departments?: unknown[] }
      | undefined
    if (b) {
      if (b.analytics !== undefined) setAnalytics(b.analytics)
      if (b.hackathons !== undefined) setHackathons(b.hackathons as never[])
      if (b.forms !== undefined) setForms(b.forms as never[])
      if (b.departments !== undefined) setDepartments(b.departments as never[])
      setLoading(false)
    }
    if (bundleQuery.error) {
      logger.error('Failed to load college data', { error: bundleQuery.error })
      setLoading(false)
    } else if (bundleQuery.isLoading && !b) {
      // Initial college load gets the full-page loader; paging has its own dim state.
      setLoading(true)
    } else if (!bundleQuery.isLoading && b) {
      setLoading(false)
    }
  }, [bundleQuery.data, bundleQuery.error, bundleQuery.isLoading])
  useEffect(() => {
    const v = usersQuery.data as unknown
    if (v !== undefined) {
      const rows = Array.isArray(v) ? (v as unknown[]) : ((v as { data?: unknown[] })?.data ?? [])
      const total = Array.isArray(v)
        ? (v as unknown[]).length
        : ((v as { pagination?: { total?: number } })?.pagination?.total ?? rows.length)
      const pages = Array.isArray(v)
        ? 1
        : ((v as { pagination?: { pages?: number } })?.pagination?.pages ??
          Math.max(1, Math.ceil(total / USERS_PAGE_SIZE)))
      setUsers(rows as never[])
      setUsersTotal(total)
      setUsersTotalPages(Math.max(1, pages))
      setRoleTotals((prev) => ({ ...prev, [userSubTab]: total }))
    }
    if (usersQuery.error) logger.error('Failed to load users', { error: usersQuery.error })
    setUsersLoading(!!usersQuery.isFetching)
  }, [usersQuery.data, usersQuery.error, usersQuery.isFetching, userSubTab])
  useEffect(() => {
    const c = roleCountsQuery.data as unknown as
      | { students?: number; teachers?: number; college_admins?: number }
      | undefined
    if (c) setRoleTotals({ students: c.students ?? 0, teachers: c.teachers ?? 0, college_admins: c.college_admins ?? 0 })
    if (roleCountsQuery.error) logger.error('Failed to load role counts', { error: roleCountsQuery.error })
  }, [roleCountsQuery.data, roleCountsQuery.error])

  // Clamp stale ?page= (e.g., page 5 when filter shrinks to 2 pages) → last page.
  useEffect(() => {
    if (usersPage > usersTotalPages) setUsersPage(usersTotalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersTotalPages])

  // ?dept= outside this college's departments (stale link) → fall back to All.
  useEffect(() => {
    if (deptFilter !== 'all' && departments.length > 0 && !departments.some((d) => d.id === deptFilter)) {
      setDeptFilter('all')
    }
  }, [departments, deptFilter])

  // Persist users view (?tab=&role=&dept=&page=) — shareable links, survives reload.
  // Preserves existing params (collegeId/collegeName); replace avoids history spam.
  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', activeTab)
    if (activeTab === 'users') {
      next.set('role', userSubTab)
      next.set('dept', deptFilter)
      next.set('page', String(usersPage))
    }
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, userSubTab, deptFilter, usersPage])

  // WHY one-click fix: sync ?collegeId/?collegeName URL → state + store when URL changes
  // (direct navigation from /superadmin/colleges, back/forward, manual edit).
  // Without this, /admin?collegeId=xxx rendered the list until a 2nd in-page click set local state.
  useEffect(() => {
    if (!isSuperAdmin) return
    const qId = searchParams.get('collegeId')
    const qName = searchParams.get('collegeName')
    if (qId && qId !== selectedCollegeId) {
      setSelectedCollegeId(qId)
      if (qName) setSelectedCollegeName(qName)
      try {
        const cur = useSuperAdminCollegeStore.getState()
        if (cur.selectedCollegeId !== qId) {
          cur.setSelectedCollege(qId, qName || cur.selectedCollegeName || qId, null)
          syncLegacyStorage(qId, qName || cur.selectedCollegeName || qId)
        }
      } catch {}
    } else if (qId && qName && qName !== selectedCollegeName) {
      setSelectedCollegeName(qName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleSelectCollege = (college: any) => {
    setSelectedCollegeId(college.id)
    setSelectedCollegeName(college.name)
    setActiveTab('analytics')
    setDeptFilter('all')
    setUsersPage(1)
    // WHY one-click fix: keep zustand + URL in sync so refresh/deep-link stays on detail
    // (was local-state only → lost on reload, scope header empty).
    try {
      useSuperAdminCollegeStore.getState().setSelectedCollege(college.id, college.name, college.code ?? null)
      syncLegacyStorage(college.id, college.name)
    } catch {}
    try {
      const next = new URLSearchParams(searchParams)
      next.set('collegeId', college.id)
      next.set('collegeName', college.name)
      next.set('tab', 'analytics')
      next.delete('page')
      setSearchParams(next, { replace: true })
    } catch {}
  }

  const handleBackToColleges = () => {
    setSelectedCollegeId(null)
    setSelectedCollegeName('')
    setAnalytics(null)
    setUsers([])
    setUsersTotal(0)
    setUsersTotalPages(1)
    setUsersPage(1)
    setHackathons([])
    setForms([])
    setDepartments([])
    setDeptFilter('all')
    try {
      useSuperAdminCollegeStore.getState().clear()
      syncLegacyStorage(null, null)
    } catch {}
    try {
      const next = new URLSearchParams(searchParams)
      next.delete('collegeId')
      next.delete('collegeName')
      setSearchParams(next, { replace: true })
    } catch {}
    void queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
  }

  // WHY: mutations refresh both the college aggregates and the paged users
  // list (totals change on add/delete/role/dept moves). Invalidate RQ so
  // totals are exact immediately (no waiting 60s staleTime).
  const refreshUsersView = (collegeId: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.admin.bundle(collegeId) })
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-role-counts'] })
    notifyEntityMutated('user')
  }

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.name) {
      toast.error('Email and name required')
      return
    }
    try {
      if (newUser.role === 'TEACHER') {
        await adminAPI.addTeacher({ ...newUser, empNumber: `EMP-${Date.now()}` })
      } else {
        await adminAPI.addStudent(newUser)
      }
      toast.success('User added!')
      setShowAddUser(false)
      setNewUser({ email: '', name: '', password: '', role: 'STUDENT', departmentId: '', studentId: '' })
      if (selectedCollegeId) refreshUsersView(selectedCollegeId)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add user')
    }
  }

  const handleDeleteUser = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete user?', message: 'Delete this user? They will lose access immediately.', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await adminAPI.deleteUser(id)
      toast.success('User deleted')
      if (selectedCollegeId) refreshUsersView(selectedCollegeId)
    } catch (err) {
      toast.error('Failed to delete user')
    }
  }

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await adminAPI.updateUser(id, { role })
      toast.success('Role updated')
      if (selectedCollegeId) refreshUsersView(selectedCollegeId)
    } catch (err) {
      toast.error('Failed to update role')
    }
  }

  const handleDeleteCollege = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete college?', message: 'Delete this college? All its data will be removed. This cannot be undone.', confirmLabel: 'Delete college' })
    if (!ok) return
    try {
      await adminAPI.deleteCollege(id)
      toast.success('College deleted')
      await queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
    } catch (err) {
      toast.error('Failed to delete college')
    }
  }

  const handleApproveCollege = async (id: string) => {
    try {
      await adminAPI.approveCollege(id)
      toast.success('College approved!')
      await queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
    } catch (err) {
      toast.error('Failed to approve college')
    }
  }

  const handleRejectCollege = async (id: string) => {
    try {
      await adminAPI.rejectCollege(id)
      toast.success('College rejected')
      await queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
    } catch (err) {
      toast.error('Failed to reject college')
    }
  }

  const handleAssignDept = async (id: string, departmentId: string) => {
    // WHY: repairs dept-less users in place (Prof. Sharma EMP001 showed no
    // department after a bulk upload with a mismatched dept name).
    if (!departmentId) return
    try {
      await adminAPI.updateUser(id, { departmentId })
      toast.success('Department assigned!')
      if (selectedCollegeId) refreshUsersView(selectedCollegeId)
      else if (isCollegeAdmin) {
        const cid = (user as any).collegeId
        void queryClient.invalidateQueries({ queryKey: qk.admin.bundle(cid) })
        void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
        void queryClient.invalidateQueries({ queryKey: ['admin-role-counts'] })
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to assign department')
    }
  }

  // Department cell: name, or Unassigned badge + inline assign when missing.
  const renderDeptCell = (u: any) =>
    u.department?.name || (
      <span className="inline-flex items-center gap-2">
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-100 dark:bg-night-700 text-surface-500 dark:text-night-300">
          Unassigned
        </span>
        <select
          value=""
          onChange={(e) => handleAssignDept(u.id, e.target.value)}
          className="px-2 py-1 border border-surface-200 dark:border-night-600 rounded-lg text-xs bg-white dark:bg-night-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          aria-label={`Assign department to ${u.name}`}
        >
          <option value="">Assign…</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </span>
    )

  const handleDeleteHackathon = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete hackathon?', message: 'Delete this hackathon and its registrations?', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await adminAPI.deleteHackathon(id)
      toast.success('Hackathon deleted')
      if (selectedCollegeId) void queryClient.invalidateQueries({ queryKey: qk.admin.bundle(selectedCollegeId) })
    } catch (err) {
      toast.error('Failed to delete hackathon')
    }
  }

  const handleDeleteForm = async (id: string) => {
    const ok = await confirmDialog({ title: 'Delete form?', message: 'Delete this form and its responses?', confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await adminAPI.deleteForm(id)
      toast.success('Form deleted')
      if (selectedCollegeId) void queryClient.invalidateQueries({ queryKey: qk.admin.bundle(selectedCollegeId) })
    } catch (err) {
      toast.error('Failed to delete form')
    }
  }

  const handleAddDept = async () => {
    if (!newDept.name.trim()) {
      toast.error('Department name required')
      return
    }
    try {
      await departmentAPI.create({ name: newDept.name.trim() })
      toast.success('Department created!')
      setShowAddDept(false)
      setNewDept({ name: '' })
      if (selectedCollegeId) {
        // Invalidate RQ bundle so the 2min staleTime doesn't restore stale depts.
        await queryClient.invalidateQueries({ queryKey: qk.admin.bundle(selectedCollegeId) })
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create department')
    }
  }

  const handleRenameDept = async (id: string) => {
    if (!renameDeptName.trim()) return
    try {
      await departmentAPI.update(id, { name: renameDeptName.trim() })
      toast.success('Department renamed!')
      setRenamingDept(null)
      if (selectedCollegeId) {
        await queryClient.invalidateQueries({ queryKey: qk.admin.bundle(selectedCollegeId) })
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to rename department')
    }
  }

  const handleDeleteDept = async (id: string, name: string, userCount: number) => {
    if (userCount > 0) {
      toast.error(`Cannot delete "${name}" — ${userCount} user(s) still assigned`)
      return
    }
    const ok = await confirmDialog({ title: 'Delete department?', message: `Delete department "${name}"?`, confirmLabel: 'Delete' })
    if (!ok) return
    try {
      await departmentAPI.delete(id)
      toast.success('Department deleted')
      if (selectedCollegeId) {
        await queryClient.invalidateQueries({ queryKey: qk.admin.bundle(selectedCollegeId) })
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete department')
    }
  }

  const handleAddCollege = async () => {
    if (!newCollege.name || !newCollege.code) {
      toast.error('Name and code required')
      return
    }
    try {
      await adminAPI.registerCollege(newCollege)
      toast.success('College registered!')
      setShowAddCollege(false)
      setNewCollege({ name: '', code: '', address: '' })
      await queryClient.invalidateQueries({ queryKey: qk.admin.colleges() })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create college')
    }
  }

  if (loading) {
    return <CenteredLoader text="Loading dashboard..." />
  }

  // ==================== SUPER ADMIN: COLLEGE LIST ====================
  if (isSuperAdmin && !selectedCollegeId) {
    return (
      <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Brand green ─── */}
      <PremiumHero
        icon={<Shield size={18} />}
        eyebrow="Admin · College"
        title={<>College Admin</>}
        subtitle="Manage users, departments and content — scoped to your college."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">Super Admin Panel</h1>
            <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Select a college to manage</p>
          </div>
        </div>

        {/* Pending Colleges */}
        {colleges.filter(c => c.status === 'PENDING').length > 0 && (
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
            <h2 className="font-bold text-surface-900 dark:text-night-50 mb-4 flex items-center gap-2">
              <Shield size={18} className="text-warning-500" />
              Pending Approval ({colleges.filter(c => c.status === 'PENDING').length})
            </h2>
            <div className="space-y-3">
              {colleges.filter(c => c.status === 'PENDING').map((c) => (
                <div key={c.id} className="p-4 bg-warning-50 rounded-xl border border-warning-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-surface-900 dark:text-night-50">{c.name}</h3>
                      <p className="text-xs text-surface-500 dark:text-night-400">Code: {c.code}</p>
                      {c.address && <p className="text-xs text-surface-500 dark:text-night-400">{c.address}</p>}
                      {c.adminEmail && <p className="text-xs text-surface-500 dark:text-night-400">Admin: {c.adminEmail}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleApproveCollege(c.id)}
                        className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-primary-600">
                        <CheckCircle size={14} /> Approve
                      </button>
                      <button onClick={() => handleRejectCollege(c.id)}
                        className="px-3 py-1.5 bg-danger-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-danger-600">
                        <XCircle size={14} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All Colleges - clickable cards */}
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-surface-900 dark:text-night-50">All Colleges ({colleges.length})</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {colleges.map((c) => (
              <button
                key={c.id}
                onClick={() => c.status === 'APPROVED' && handleSelectCollege(c)}
                className={clsx(
                  'p-4 rounded-xl border text-left transition-all',
                  c.status === 'APPROVED'
                    ? 'bg-primary-50 border-primary-200 hover:border-primary-400 hover:shadow-md cursor-pointer'
                    : c.status === 'REJECTED'
                      ? 'bg-danger-50 border-danger-200 cursor-not-allowed opacity-60'
                      : 'bg-surface-50 border-surface-100 cursor-not-allowed opacity-60'
                )}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-primary-100 flex items-center justify-center">
                      <Building2 size={18} className="text-primary-600" />
                    </div>
                    <h3 className="font-bold text-surface-900 dark:text-night-50 text-sm">{c.name}</h3>
                  </div>
                  {isSuperAdmin && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteCollege(c.id) }}
                      className="p-1 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p className="text-xs text-surface-500 dark:text-night-400 mb-2">Code: {c.code}</p>
                {c.address && <p className="text-xs text-surface-500 dark:text-night-400 mb-2">{c.address}</p>}
                <div className="flex items-center gap-2 mb-2">
                  <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold',
                    c.status === 'APPROVED' ? 'bg-primary-100 text-primary-700' :
                    c.status === 'REJECTED' ? 'bg-danger-100 text-danger-700' :
                    'bg-warning-100 text-warning-700'
                  )}>
                    {c.status}
                  </span>
                </div>
                <div className="flex gap-4 text-xs text-surface-500 dark:text-night-400">
                  <span>{c._count?.users ?? 0} users</span>
                  <span>{c._count?.hackathons ?? 0} hackathons</span>
                </div>
                {c.status === 'APPROVED' && (
                  <p className="text-xs text-primary-600 mt-2 font-medium">Click to manage →</p>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ==================== COLLEGE-SCOPED VIEW (College Admin or Super Admin inside a college) ====================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSuperAdmin && (
            <button onClick={handleBackToColleges}
              className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-night-700 text-surface-500 dark:text-night-400 transition-all dark:bg-[#1e1e1e]">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">
              {isSuperAdmin ? selectedCollegeName : 'College Admin Panel'}
            </h1>
            <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Manage users, departments, and content</p>
          </div>
        </div>
      </div>

      {/* Tabs — RQ prefetch on hover/focus warms the target query so hover→click
          renders from cache instantly (Vercel instant-nav). staleTime-gated
          no-op when fresh; role sub-tabs warm the other role's first page. */}
      <div className="flex gap-2 border-b border-surface-100 dark:border-night-600 pb-2 overflow-x-auto" role="tablist" aria-label="Admin sections">
        <button
          role="tab"
          aria-selected={activeTab === 'analytics'}
          onClick={() => setActiveTab('analytics')}
          onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'analytics' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <BarChart3 size={16} className="inline mr-2" /> Analytics
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'users'}
          onClick={() => setActiveTab('users')}
          onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, usersRole, deptFilter, usersPage), staleTime: 60 * 1000 }) }}
          onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, usersRole, deptFilter, usersPage), staleTime: 60 * 1000 }) }}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'users' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <Users size={16} className="inline mr-2" /> Users
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'departments'}
          onClick={() => setActiveTab('departments')}
          onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'departments' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <FolderPlus size={16} className="inline mr-2" /> Departments
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'content'}
          onClick={() => setActiveTab('content')}
          onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.bundle(cid), staleTime: 2 * 60 * 1000 }) }}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'content' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <FileText size={16} className="inline mr-2" /> Content
        </button>
      </div>

      {/* Analytics Tab — keep-alive: all 4 panels stay mounted, inactive hidden
          with CSS (no remount, preserves scroll/DOM, no re-animation flash).
          Data comes from bundleCache (2min stale); switching tabs never fetches. */}
      <div className={activeTab === 'analytics' ? '' : 'hidden'}>
      {analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                <Users size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{analytics.totalStudents}</p>
                <p className="text-xs text-surface-500 dark:text-night-400">Students</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                <Shield size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{analytics.totalTeachers}</p>
                <p className="text-xs text-surface-500 dark:text-night-400">Teachers</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning-100 flex items-center justify-center">
                <Trophy size={20} className="text-warning-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{analytics.hackathons}</p>
                <p className="text-xs text-surface-500 dark:text-night-400">Hackathons</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                <FileText size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900 dark:text-night-50">{analytics.forms}</p>
                <p className="text-xs text-surface-500 dark:text-night-400">Forms</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      </div>

      {/* Departments Tab — keep-alive (see above). */}
      <div className={activeTab === 'departments' ? '' : 'hidden'}>
      {(
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-surface-900 dark:text-night-50">Departments ({departments.length})</h2>
            <button onClick={() => setShowAddDept(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium">
              <FolderPlus size={14} /> Add Department
            </button>
          </div>
          <div className="space-y-2">
            {departments.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 bg-surface-50 dark:bg-night-800 rounded-xl">
                <div className="flex items-center gap-3 flex-1">
                  {renamingDept === d.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <label htmlFor={`rename-dept-${d.id}`} className="sr-only">Rename department {d.name}</label>
                      <input id={`rename-dept-${d.id}`} type="text" value={renameDeptName}
                        onChange={(e) => setRenameDeptName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameDept(d.id)}
                        aria-label={`Rename department ${d.name}`}
                        className="flex-1 px-3 min-h-[44px] border border-primary-300 rounded-lg text-sm placeholder:text-[#6b7280] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                        autoFocus />
                      <button onClick={() => handleRenameDept(d.id)}
                        className="px-2 py-1 bg-primary-500 text-white rounded-lg text-xs font-medium">Save</button>
                      <button onClick={() => setRenamingDept(null)}
                        className="px-2 py-1 bg-surface-200 text-surface-600 dark:text-night-300 rounded-lg text-xs font-medium dark:bg-[#282828]">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">
                        {d.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-surface-900 dark:text-night-50 text-sm">{d.name}</p>
                        <p className="text-xs text-surface-400 dark:text-night-400">{d._count?.users || 0} users</p>
                      </div>
                    </>
                  )}
                </div>
                {renamingDept !== d.id && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setRenamingDept(d.id); setRenameDeptName(d.name) }}
                      className="px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg">
                      Rename
                    </button>
                    <button onClick={() => handleDeleteDept(d.id, d.name, d._count?.users || 0)}
                      className="p-1 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {departments.length === 0 && (
              <p className="text-center text-surface-400 dark:text-night-400 py-8">No departments yet. Add one to get started.</p>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Users Tab — keep-alive (see above). */}
      <div className={activeTab === 'users' ? '' : 'hidden'}>
      {(
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-surface-900 dark:text-night-50">Users ({usersTotal})</h2>
              {usersTotalPages > 1 && (
                <p className="text-xs text-surface-500 dark:text-night-400 mt-0.5">
                  Showing {(usersPage - 1) * USERS_PAGE_SIZE + (users.length ? 1 : 0)}–{(usersPage - 1) * USERS_PAGE_SIZE + users.length} of {usersTotal} · {USERS_PAGE_SIZE} per page
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setBulkOpen(true)}
                className="flex items-center gap-2 px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 rounded-xl hover:bg-surface-50 dark:hover:bg-night-700 transition-all text-sm font-medium text-surface-700 dark:text-night-200">
                <FileText size={14} /> Bulk import
              </button>
              <button onClick={() => navigate('/admin/add-teachers')}
                className="flex items-center gap-2 px-3 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium">
                <UserPlus size={14} /> Add Teachers
              </button>
              <button onClick={() => navigate('/admin/add-students')}
                className="flex items-center gap-2 px-3 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium">
                <UserPlus size={14} /> Add Students
              </button>
            </div>
          </div>

          {/* Sub-tabs for roles — counts are server-side GROUP BY totals, not page length.
              RQ prefetch on hover warms the other role's first page (staleTime-gated). */}
          <div className="flex gap-2 mb-4 border-b border-surface-100 dark:border-night-600 pb-2" role="tablist" aria-label="Filter users by role">
            <button
              role="tab"
              aria-selected={userSubTab === 'students'}
              onClick={() => { setUserSubTab('students'); setUsersPage(1) }}
              onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'STUDENT', deptFilter, 1), staleTime: 60 * 1000 }) }}
              onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'STUDENT', deptFilter, 1), staleTime: 60 * 1000 }) }}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'students' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              Students ({roleTotals.students})
            </button>
            <button
              role="tab"
              aria-selected={userSubTab === 'teachers'}
              onClick={() => { setUserSubTab('teachers'); setUsersPage(1) }}
              onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'TEACHER', deptFilter, 1), staleTime: 60 * 1000 }) }}
              onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'TEACHER', deptFilter, 1), staleTime: 60 * 1000 }) }}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'teachers' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              Teachers ({roleTotals.teachers})
            </button>
            <button
              role="tab"
              aria-selected={userSubTab === 'college_admins'}
              onClick={() => { setUserSubTab('college_admins'); setUsersPage(1) }}
              onMouseEnter={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'COLLEGE_ADMIN', deptFilter, 1), staleTime: 60 * 1000 }) }}
              onFocus={() => { const cid = effectiveCollegeId; if (cid) void queryClient.prefetchQuery({ queryKey: qk.admin.users(cid, 'COLLEGE_ADMIN', deptFilter, 1), staleTime: 60 * 1000 }) }}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'college_admins' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              College Admins ({roleTotals.college_admins})
            </button>
          </div>

          {/* Department filter — shared by the students + teachers lists, default All */}
          {(userSubTab === 'students' || userSubTab === 'teachers') && (
            <div className="flex items-center gap-2 mb-4">
              <label htmlFor="dept-filter" className="text-xs font-semibold text-surface-500 dark:text-night-400 uppercase tracking-wide">
                Department
              </label>
              <select
                id="dept-filter"
                value={departments.some((d) => d.id === deptFilter) ? deptFilter : 'all'}
                onChange={(e) => { setDeptFilter(e.target.value); setUsersPage(1) }}
                disabled={usersLoading}
                className="px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-white dark:bg-night-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 disabled:opacity-50"
              >
                <option value="all">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              {usersLoading && <span className="text-xs text-surface-400 dark:text-night-400">Filtering…</span>}
            </div>
          )}

          {/* Filtered user table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100 dark:border-night-600">
                  <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Name</th>
                  <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Email</th>
                  {userSubTab === 'students' && (
                    <>
                      <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Roll Number</th>
                      <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Department</th>
                      <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Year</th>
                    </>
                  )}
                  {userSubTab === 'teachers' && (
                    <>
                      <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Emp Number</th>
                      <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Department</th>
                    </>
                  )}
                  <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .filter(u => {
                    if (userSubTab === 'students') return u.role === 'STUDENT'
                    if (userSubTab === 'teachers') return u.role === 'TEACHER'
                    if (userSubTab === 'college_admins') return u.role === 'COLLEGE_ADMIN'
                    return true
                  })
                  .map((u) => (
                    <tr key={u.id} className="border-b border-surface-50 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-all">
                      <td className="py-2 font-medium text-surface-900 dark:text-night-50">{u.name}</td>
                      <td className="py-2 text-surface-600 dark:text-night-300">{u.email}</td>
                      {userSubTab === 'students' && (
                        <>
                          <td className="py-2 text-surface-600 dark:text-night-300">{u.studentId || '-'}</td>
                          <td className="py-2 text-surface-600 dark:text-night-300">{renderDeptCell(u)}</td>
                          <td className="py-2 text-surface-600 dark:text-night-300">{u.incomingYear ? `Year ${Math.min(new Date().getFullYear() - u.incomingYear + 1, 4)}` : '-'}</td>
                        </>
                      )}
                      {userSubTab === 'teachers' && (
                        <>
                          <td className="py-2 text-surface-600 dark:text-night-300">{u.empNumber || '-'}</td>
                          <td className="py-2 text-surface-600 dark:text-night-300">{renderDeptCell(u)}</td>
                        </>
                      )}
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className={clsx('px-2 py-1 rounded-full text-xs font-semibold border-0',
                              u.role === 'SUPER_ADMIN' ? 'bg-danger-100 text-danger-700' :
                              u.role === 'COLLEGE_ADMIN' ? 'bg-primary-100 text-primary-700' :
                              u.role === 'TEACHER' ? 'bg-primary-100 text-primary-700' :
                              'bg-primary-100 text-primary-700'
                            )}
                          >
                            <option value="STUDENT">Student</option>
                            <option value="TEACHER">Teacher</option>
                            <option value="COLLEGE_ADMIN">College Admin</option>
                            {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                          </select>
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {users.filter(u => {
              if (userSubTab === 'students') return u.role === 'STUDENT'
              if (userSubTab === 'teachers') return u.role === 'TEACHER'
              if (userSubTab === 'college_admins') return u.role === 'COLLEGE_ADMIN'
              return false
            }).length === 0 && !usersLoading && (
              <p className="text-center text-surface-400 dark:text-night-400 py-8">No users in this category</p>
            )}
          </div>

          {/* Pager — Prev/Next + page numbers + total (limit 50, shared Pagination).
              WHY inner scroll=false: table lives inside a panel; scrolling main
              to top on every page turn would lose table context. */}
          <Pagination page={usersPage} totalPages={usersTotalPages} onChange={setUsersPage} scroll={false} />
        </div>
      )}
      </div>

      {/* Content Tab (Hackathons & Forms) — keep-alive (see above). */}
      <div className={activeTab === 'content' ? '' : 'hidden'}>
      {(
        <div className="space-y-6">
          {/* Hackathons */}
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900 dark:text-night-50">Hackathons ({hackathons.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100 dark:border-night-600">
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Name</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Creator</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Registrations</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hackathons.map((h) => (
                    <tr key={h.id} className="border-b border-surface-50 dark:border-night-600">
                      <td className="py-2 font-medium text-surface-900 dark:text-night-50">{h.name}</td>
                      <td className="py-2 text-surface-600 dark:text-night-300">{h.creator?.name || 'Unknown'}</td>
                      <td className="py-2 text-surface-600 dark:text-night-300">{h.registrations?.length || 0}</td>
                      <td className="py-2">
                        <button
                          onClick={() => handleDeleteHackathon(h.id)}
                          className="p-1 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {hackathons.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-surface-400 dark:text-night-400">No hackathons found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Forms */}
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900 dark:text-night-50">Forms ({forms.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100 dark:border-night-600">
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Title</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Creator</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Responses</th>
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.id} className="border-b border-surface-50 dark:border-night-600">
                      <td className="py-2 font-medium text-surface-900 dark:text-night-50">{f.title}</td>
                      <td className="py-2 text-surface-600 dark:text-night-300">{f.creator?.name || 'Unknown'}</td>
                      <td className="py-2 text-surface-600 dark:text-night-300">{f.responses?.length || 0}</td>
                      <td className="py-2">
                        <button
                          onClick={() => handleDeleteForm(f.id)}
                          className="p-1 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 hover:bg-danger-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {forms.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-surface-400 dark:text-night-400">No forms found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddUser(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Add User</h2>
              <div className="space-y-3">
                {/* WHY: raw inputs migrated to labelled Input (was placeholder-only, fails 3.3.2). */}
                <Input label="Full name" type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Name" />
                <Input label="Email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="name@college.edu" />
                <Input label="Temporary password" type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="Temporary password (auto-generated if blank, min 8)" hint="Min 8 characters. Leave blank to auto-generate." />
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm">
                  <option value="STUDENT">Student</option>
                  <option value="TEACHER">Teacher</option>
                  <option value="COLLEGE_ADMIN">College Admin</option>
                </select>
                <select value={newUser.departmentId} onChange={(e) => setNewUser({ ...newUser, departmentId: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm">
                  <option value="">Select department</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input type="text" value={newUser.studentId} onChange={(e) => setNewUser({ ...newUser, studentId: e.target.value })}
                  aria-label="Student ID (optional)" placeholder="Student ID (optional)"
                  className="w-full px-3 min-h-[44px] border border-surface-200 dark:border-night-600 rounded-xl text-sm placeholder:text-[#6b7280] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2" />
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddUser(false)} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddUser} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium">Add</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add College Modal */}
      <AnimatePresence>
        {showAddCollege && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddCollege(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Add College</h2>
              <div className="space-y-3">
                <Input label="College name" type="text" value={newCollege.name} onChange={(e) => setNewCollege({ ...newCollege, name: e.target.value })} placeholder="College name" />
                <Input label="College code" type="text" value={newCollege.code} onChange={(e) => setNewCollege({ ...newCollege, code: e.target.value })} placeholder="College code (e.g., MIT)" />
                <Input label="Address (optional)" type="text" value={newCollege.address} onChange={(e) => setNewCollege({ ...newCollege, address: e.target.value })} placeholder="Address (optional)" />
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddCollege(false)} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddCollege} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Department Modal */}
      <AnimatePresence>
        {showAddDept && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowAddDept(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Add Department</h2>
              <Input label="Department name" type="text" value={newDept.name}
                onChange={(e) => setNewDept({ name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDept()}
                placeholder="e.g., Computer Science" />
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddDept(false)} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddDept} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* #11 bulk CSV import (dry-run → confirm). College scope follows the
          current view; role follows the users sub-tab. */}
      <BulkImportModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        collegeId={effectiveCollegeId}
        role={(userSubTab === 'teachers' ? 'TEACHER' : 'STUDENT') as BulkRole}
        onImported={() => { if (effectiveCollegeId) refreshUsersView(effectiveCollegeId) }}
      />
    </div>
  )
}


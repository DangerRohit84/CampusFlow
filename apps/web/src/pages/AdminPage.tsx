import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '../store/authStore'
import { adminAPI, departmentAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, GraduationCap, Trophy, FileText, Trash2, BarChart3, Shield, CheckCircle, XCircle,
  UserPlus, FolderPlus, ArrowLeft, Building2
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'

export default function AdminPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isCollegeAdmin = user?.role === 'COLLEGE_ADMIN'

  const [loading, setLoading] = useState(true)
  const [colleges, setColleges] = useState<any[]>([])
  const [selectedCollegeId, setSelectedCollegeId] = useState<string | null>(
    isSuperAdmin ? null : (user as any)?.collegeId || null
  )
  const [selectedCollegeName, setSelectedCollegeName] = useState<string>(
    isSuperAdmin ? '' : 'My College'
  )

  const [activeTab, setActiveTab] = useState<'analytics' | 'users' | 'departments' | 'content'>('analytics')
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
  const [userSubTab, setUserSubTab] = useState<'students' | 'teachers' | 'college_admins'>('students')
  const [showAddCollege, setShowAddCollege] = useState(false)
  const [newCollege, setNewCollege] = useState({ name: '', code: '', address: '' })

  const loadColleges = useCallback(async () => {
    try {
      const data = await adminAPI.getColleges()
      setColleges(data)
    } catch {
      console.error('Failed to load colleges')
    }
  }, [])

  const loadCollegeData = useCallback(async (collegeId: string) => {
    try {
      setLoading(true)
      const results = await Promise.allSettled([
        adminAPI.getAnalytics(collegeId),
        adminAPI.getUsers(collegeId),
        adminAPI.getHackathons(collegeId),
        adminAPI.getForms(collegeId),
        departmentAPI.getAll(collegeId),
      ])
      if (results[0].status === 'fulfilled') setAnalytics(results[0].value)
      if (results[1].status === 'fulfilled') setUsers(results[1].value)
      if (results[2].status === 'fulfilled') setHackathons(results[2].value)
      if (results[3].status === 'fulfilled') setForms(results[3].value)
      if (results[4].status === 'fulfilled') setDepartments(results[4].value)
    } catch (err) {
      console.error('Failed to load college data', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isSuperAdmin && !selectedCollegeId) {
      setLoading(false)
      loadColleges()
    } else if (selectedCollegeId) {
      loadCollegeData(selectedCollegeId)
    } else if (isCollegeAdmin) {
      loadCollegeData((user as any).collegeId)
    }
  }, [selectedCollegeId])

  const handleSelectCollege = (college: any) => {
    setSelectedCollegeId(college.id)
    setSelectedCollegeName(college.name)
    setActiveTab('analytics')
  }

  const handleBackToColleges = () => {
    setSelectedCollegeId(null)
    setSelectedCollegeName('')
    setAnalytics(null)
    setUsers([])
    setHackathons([])
    setForms([])
    setDepartments([])
    loadColleges()
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
      if (selectedCollegeId) loadCollegeData(selectedCollegeId)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add user')
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await adminAPI.deleteUser(id)
      toast.success('User deleted')
      if (selectedCollegeId) loadCollegeData(selectedCollegeId)
    } catch (err) {
      toast.error('Failed to delete user')
    }
  }

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await adminAPI.updateUser(id, { role })
      toast.success('Role updated')
      if (selectedCollegeId) loadCollegeData(selectedCollegeId)
    } catch (err) {
      toast.error('Failed to update role')
    }
  }

  const handleDeleteCollege = async (id: string) => {
    if (!confirm('Delete this college? All its data will be removed.')) return
    try {
      await adminAPI.deleteCollege(id)
      toast.success('College deleted')
      loadColleges()
    } catch (err) {
      toast.error('Failed to delete college')
    }
  }

  const handleApproveCollege = async (id: string) => {
    try {
      await adminAPI.approveCollege(id)
      toast.success('College approved!')
      loadColleges()
    } catch (err) {
      toast.error('Failed to approve college')
    }
  }

  const handleRejectCollege = async (id: string) => {
    try {
      await adminAPI.rejectCollege(id)
      toast.success('College rejected')
      loadColleges()
    } catch (err) {
      toast.error('Failed to reject college')
    }
  }

  const handleDeleteHackathon = async (id: string) => {
    if (!confirm('Delete this hackathon?')) return
    try {
      await adminAPI.deleteHackathon(id)
      toast.success('Hackathon deleted')
      if (selectedCollegeId) loadCollegeData(selectedCollegeId)
    } catch (err) {
      toast.error('Failed to delete hackathon')
    }
  }

  const handleDeleteForm = async (id: string) => {
    if (!confirm('Delete this form?')) return
    try {
      await adminAPI.deleteForm(id)
      toast.success('Form deleted')
      if (selectedCollegeId) loadCollegeData(selectedCollegeId)
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
        const depts = await departmentAPI.getAll(selectedCollegeId)
        setDepartments(depts)
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
        const depts = await departmentAPI.getAll(selectedCollegeId)
        setDepartments(depts)
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
    if (!confirm(`Delete department "${name}"?`)) return
    try {
      await departmentAPI.delete(id)
      toast.success('Department deleted')
      if (selectedCollegeId) {
        const depts = await departmentAPI.getAll(selectedCollegeId)
        setDepartments(depts)
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
      loadColleges()
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
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
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

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 dark:border-night-600 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('analytics')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'analytics' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <BarChart3 size={16} className="inline mr-2" /> Analytics
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'users' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <Users size={16} className="inline mr-2" /> Users
        </button>
        <button
          onClick={() => setActiveTab('departments')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'departments' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <FolderPlus size={16} className="inline mr-2" /> Departments
        </button>
        <button
          onClick={() => setActiveTab('content')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'content' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
          )}
        >
          <FileText size={16} className="inline mr-2" /> Content
        </button>
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && analytics && (
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

      {/* Departments Tab */}
      {activeTab === 'departments' && (
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
                      <input type="text" value={renameDeptName}
                        onChange={(e) => setRenameDeptName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameDept(d.id)}
                        className="flex-1 px-3 py-1 border border-primary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-surface-900 dark:text-night-50">Users ({users.length})</h2>
            <div className="flex gap-2">
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

          {/* Sub-tabs for roles */}
          <div className="flex gap-2 mb-4 border-b border-surface-100 dark:border-night-600 pb-2">
            <button
              onClick={() => setUserSubTab('students')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'students' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              Students ({users.filter(u => u.role === 'STUDENT').length})
            </button>
            <button
              onClick={() => setUserSubTab('teachers')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'teachers' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              Teachers ({users.filter(u => u.role === 'TEACHER').length})
            </button>
            <button
              onClick={() => setUserSubTab('college_admins')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'college_admins' ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300' : 'text-surface-500 dark:text-zinc-400 hover:bg-surface-100 dark:hover:bg-white/5 hover:text-surface-700 dark:hover:text-white'
              )}
            >
              College Admins ({users.filter(u => u.role === 'COLLEGE_ADMIN').length})
            </button>
          </div>

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
                    <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Emp Number</th>
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
                          <td className="py-2 text-surface-600 dark:text-night-300">{u.department?.name || '-'}</td>
                          <td className="py-2 text-surface-600 dark:text-night-300">{u.incomingYear ? `Year ${Math.min(new Date().getFullYear() - u.incomingYear + 1, 4)}` : '-'}</td>
                        </>
                      )}
                      {userSubTab === 'teachers' && (
                        <td className="py-2 text-surface-600 dark:text-night-300">{u.empNumber || '-'}</td>
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
            }).length === 0 && (
              <p className="text-center text-surface-400 dark:text-night-400 py-8">No users in this category</p>
            )}
          </div>
        </div>
      )}

      {/* Content Tab (Hackathons & Forms) */}
      {activeTab === 'content' && (
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
                <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="Name" />
                <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="Email" />
                <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="Password (default: password123)" />
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
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="Student ID (optional)" />
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
                <input type="text" value={newCollege.name} onChange={(e) => setNewCollege({ ...newCollege, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="College name" />
                <input type="text" value={newCollege.code} onChange={(e) => setNewCollege({ ...newCollege, code: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="College code (e.g., MIT)" />
                <input type="text" value={newCollege.address} onChange={(e) => setNewCollege({ ...newCollege, address: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm" placeholder="Address (optional)" />
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
              <input type="text" value={newDept.name}
                onChange={(e) => setNewDept({ name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDept()}
                className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="e.g., Computer Science" autoFocus />
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddDept(false)} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddDept} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

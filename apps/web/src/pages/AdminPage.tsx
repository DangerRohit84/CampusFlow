import { useState, useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { adminAPI, departmentAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, GraduationCap, Trophy, FileText, Trash2,
  Loader2, BarChart3, Shield, CheckCircle, XCircle,
  UserPlus, ClipboardList, FolderPlus
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'

export default function AdminPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'analytics' | 'users' | 'content' | 'colleges' | 'departments'>('analytics')
  const [users, setUsers] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<any>(null)
  const [colleges, setColleges] = useState<any[]>([])
  const [hackathons, setHackathons] = useState<any[]>([])
  const [forms, setForms] = useState<any[]>([])
  const [departments, setDepartments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddUser, setShowAddUser] = useState(false)
  const [showAddCollege, setShowAddCollege] = useState(false)
  const [showAddDept, setShowAddDept] = useState(false)
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'STUDENT', departmentId: '', studentId: '' })
  const [newCollege, setNewCollege] = useState({ name: '', code: '', address: '' })
  const [newDept, setNewDept] = useState({ name: '' })
  const [renamingDept, setRenamingDept] = useState<string | null>(null)
  const [renameDeptName, setRenameDeptName] = useState('')
  const [userSubTab, setUserSubTab] = useState<'students' | 'teachers' | 'college_admins' | 'super_admins'>('students')

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isCollegeAdmin = user?.role === 'COLLEGE_ADMIN'
  const isAdmin = isCollegeAdmin || isSuperAdmin

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [usersData, analyticsData, hackathonsData, formsData, deptsData] = await Promise.all([
        adminAPI.getUsers(),
        adminAPI.getAnalytics(),
        adminAPI.getHackathons(),
        adminAPI.getForms(),
        departmentAPI.getAll(),
      ])
      setUsers(usersData)
      setAnalytics(analyticsData)
      setHackathons(hackathonsData)
      setForms(formsData)
      setDepartments(deptsData)

      if (isSuperAdmin) {
        const collegesData = await adminAPI.getColleges()
        setColleges(collegesData)
      }
    } catch (err) {
      console.error('Failed to load admin data', err)
    } finally {
      setLoading(false)
    }
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
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add user')
    }
  }

  const handleDeleteUser = async (id: string) => {
    if (!confirm('Delete this user?')) return
    try {
      await adminAPI.deleteUser(id)
      toast.success('User deleted')
      loadData()
    } catch (err) {
      toast.error('Failed to delete user')
    }
  }

  const handleRoleChange = async (id: string, role: string) => {
    try {
      await adminAPI.updateUser(id, { role })
      toast.success('Role updated')
      loadData()
    } catch (err) {
      toast.error('Failed to update role')
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
      loadData()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create college')
    }
  }

  const handleDeleteCollege = async (id: string) => {
    if (!confirm('Delete this college?')) return
    try {
      await adminAPI.deleteCollege(id)
      toast.success('College deleted')
      loadData()
    } catch (err) {
      toast.error('Failed to delete college')
    }
  }

  const handleApproveCollege = async (id: string) => {
    try {
      await adminAPI.approveCollege(id)
      toast.success('College approved!')
      loadData()
    } catch (err) {
      toast.error('Failed to approve college')
    }
  }

  const handleRejectCollege = async (id: string) => {
    try {
      await adminAPI.rejectCollege(id)
      toast.success('College rejected')
      loadData()
    } catch (err) {
      toast.error('Failed to reject college')
    }
  }

  const handleDeleteHackathon = async (id: string) => {
    if (!confirm('Delete this hackathon?')) return
    try {
      await adminAPI.deleteHackathon(id)
      toast.success('Hackathon deleted')
      loadData()
    } catch (err) {
      toast.error('Failed to delete hackathon')
    }
  }

  const handleDeleteForm = async (id: string) => {
    if (!confirm('Delete this form?')) return
    try {
      await adminAPI.deleteForm(id)
      toast.success('Form deleted')
      loadData()
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
      const depts = await departmentAPI.getAll()
      setDepartments(depts)
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
      const depts = await departmentAPI.getAll()
      setDepartments(depts)
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
      const depts = await departmentAPI.getAll()
      setDepartments(depts)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to delete department')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">
            {isSuperAdmin ? 'Super Admin Panel' : 'College Admin Panel'}
          </h1>
          <p className="text-surface-500 text-sm mt-1">Manage users and view analytics</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('analytics')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'analytics' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
          )}
        >
          <BarChart3 size={16} className="inline mr-2" /> Analytics
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'users' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
          )}
        >
          <Users size={16} className="inline mr-2" /> Users
        </button>
        {(isCollegeAdmin || isSuperAdmin) && (
          <button
            onClick={() => setActiveTab('departments')}
            className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
              activeTab === 'departments' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
            )}
          >
            <FolderPlus size={16} className="inline mr-2" /> Departments
          </button>
        )}
        <button
          onClick={() => setActiveTab('content')}
          className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
            activeTab === 'content' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
          )}
        >
          <FileText size={16} className="inline mr-2" /> Content
        </button>
        {isSuperAdmin && (
          <button
            onClick={() => setActiveTab('colleges')}
            className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
              activeTab === 'colleges' ? 'bg-primary-50 text-primary-700' : 'text-surface-500 hover:bg-surface-100'
            )}
          >
            <GraduationCap size={16} className="inline mr-2" /> Colleges
          </button>
        )}
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && analytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-surface-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Users size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{analytics.totalStudents}</p>
                <p className="text-xs text-surface-500">Students</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-surface-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                <Shield size={20} className="text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{analytics.totalTeachers}</p>
                <p className="text-xs text-surface-500">Teachers</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-surface-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                <Trophy size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{analytics.hackathons}</p>
                <p className="text-xs text-surface-500">Hackathons</p>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl border border-surface-100 p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <FileText size={20} className="text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{analytics.forms}</p>
                <p className="text-xs text-surface-500">Forms</p>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Departments Tab */}
      {activeTab === 'departments' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-surface-900">Departments ({departments.length})</h2>
            <button onClick={() => setShowAddDept(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium">
              <FolderPlus size={14} /> Add Department
            </button>
          </div>
          <div className="space-y-2">
            {departments.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
                <div className="flex items-center gap-3 flex-1">
                  {renamingDept === d.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="text" value={renameDeptName}
                        onChange={(e) => setRenameDeptName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleRenameDept(d.id)}
                        className="flex-1 px-3 py-1 border border-primary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        autoFocus />
                      <button onClick={() => handleRenameDept(d.id)}
                        className="px-2 py-1 bg-green-500 text-white rounded-lg text-xs font-medium">Save</button>
                      <button onClick={() => setRenamingDept(null)}
                        className="px-2 py-1 bg-surface-200 text-surface-600 rounded-lg text-xs font-medium">Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm">
                        {d.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-surface-900 text-sm">{d.name}</p>
                        <p className="text-xs text-surface-400">{d._count?.users || 0} users</p>
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
                      className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {departments.length === 0 && (
              <p className="text-center text-surface-400 py-8">No departments yet. Add one to get started.</p>
            )}
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-surface-900">Users</h2>
            <div className="flex gap-2">
              {isCollegeAdmin && (
                <>
                  <button onClick={() => navigate('/admin/add-teachers')}
                    className="flex items-center gap-2 px-3 py-2 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-all text-sm font-medium">
                    <UserPlus size={14} /> Add Teachers
                  </button>
                  <button onClick={() => navigate('/admin/add-students')}
                    className="flex items-center gap-2 px-3 py-2 bg-green-500 text-white rounded-xl hover:bg-green-600 transition-all text-sm font-medium">
                    <UserPlus size={14} /> Add Students
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Sub-tabs for roles */}
          <div className="flex gap-2 mb-4 border-b border-surface-100 pb-2">
            <button
              onClick={() => setUserSubTab('students')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'students' ? 'bg-green-50 text-green-700' : 'text-surface-500 hover:bg-surface-100'
              )}
            >
              Students ({users.filter(u => u.role === 'STUDENT').length})
            </button>
            <button
              onClick={() => setUserSubTab('teachers')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'teachers' ? 'bg-blue-50 text-blue-700' : 'text-surface-500 hover:bg-surface-100'
              )}
            >
              Teachers ({users.filter(u => u.role === 'TEACHER').length})
            </button>
            <button
              onClick={() => setUserSubTab('college_admins')}
              className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                userSubTab === 'college_admins' ? 'bg-purple-50 text-purple-700' : 'text-surface-500 hover:bg-surface-100'
              )}
            >
              College Admins ({users.filter(u => u.role === 'COLLEGE_ADMIN').length})
            </button>
            {isSuperAdmin && (
              <button
                onClick={() => setUserSubTab('super_admins')}
                className={clsx('px-4 py-2 rounded-xl text-sm font-medium transition-all',
                  userSubTab === 'super_admins' ? 'bg-red-50 text-red-700' : 'text-surface-500 hover:bg-surface-100'
                )}
              >
                Super Admins ({users.filter(u => u.role === 'SUPER_ADMIN').length})
              </button>
            )}
          </div>

          {/* Filtered user table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="text-left py-2 text-surface-500 font-medium">Name</th>
                  <th className="text-left py-2 text-surface-500 font-medium">Email</th>
                  {userSubTab === 'students' && (
                    <>
                      <th className="text-left py-2 text-surface-500 font-medium">Roll Number</th>
                      <th className="text-left py-2 text-surface-500 font-medium">Department</th>
                      <th className="text-left py-2 text-surface-500 font-medium">Year</th>
                    </>
                  )}
                  {userSubTab === 'teachers' && (
                    <th className="text-left py-2 text-surface-500 font-medium">Emp Number</th>
                  )}
                  <th className="text-left py-2 text-surface-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users
                  .filter(u => {
                    if (userSubTab === 'students') return u.role === 'STUDENT'
                    if (userSubTab === 'teachers') return u.role === 'TEACHER'
                    if (userSubTab === 'college_admins') return u.role === 'COLLEGE_ADMIN'
                    if (userSubTab === 'super_admins') return u.role === 'SUPER_ADMIN'
                    return true
                  })
                  .map((u) => (
                    <tr key={u.id} className="border-b border-surface-50 hover:bg-surface-50 transition-all">
                      <td className="py-2 font-medium text-surface-900">{u.name}</td>
                      <td className="py-2 text-surface-600">{u.email}</td>
                      {userSubTab === 'students' && (
                        <>
                          <td className="py-2 text-surface-600">{u.studentId || '-'}</td>
                          <td className="py-2 text-surface-600">{u.department?.name || '-'}</td>
                          <td className="py-2 text-surface-600">{u.incomingYear ? `Year ${Math.min(new Date().getFullYear() - u.incomingYear + 1, 4)}` : '-'}</td>
                        </>
                      )}
                      {userSubTab === 'teachers' && (
                        <td className="py-2 text-surface-600">{u.empNumber || '-'}</td>
                      )}
                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          {userSubTab !== 'super_admins' && (
                            <select
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                              className={clsx('px-2 py-1 rounded-full text-xs font-semibold border-0',
                                u.role === 'SUPER_ADMIN' ? 'bg-red-100 text-red-700' :
                                u.role === 'COLLEGE_ADMIN' ? 'bg-purple-100 text-purple-700' :
                                u.role === 'TEACHER' ? 'bg-blue-100 text-blue-700' :
                                'bg-green-100 text-green-700'
                              )}
                            >
                              <option value="STUDENT">Student</option>
                              <option value="TEACHER">Teacher</option>
                              <option value="COLLEGE_ADMIN">College Admin</option>
                              {isSuperAdmin && <option value="SUPER_ADMIN">Super Admin</option>}
                            </select>
                          )}
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50"
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
              if (userSubTab === 'super_admins') return u.role === 'SUPER_ADMIN'
              return false
            }).length === 0 && (
              <p className="text-center text-surface-400 py-8">No users in this category</p>
            )}
          </div>
        </div>
      )}

      {/* Content Tab (Hackathons & Forms) */}
      {activeTab === 'content' && (
        <div className="space-y-6">
          {/* Hackathons */}
          <div className="bg-white rounded-2xl border border-surface-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900">Hackathons ({hackathons.length})</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100">
                    <th className="text-left py-2 text-surface-500 font-medium">Name</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Creator</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Registrations</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hackathons.map((h) => (
                    <tr key={h.id} className="border-b border-surface-50">
                      <td className="py-2 font-medium text-surface-900">{h.name}</td>
                      <td className="py-2 text-surface-600">{h.creator?.name || 'Unknown'}</td>
                      <td className="py-2 text-surface-600">{h.registrations?.length || 0}</td>
                      <td className="py-2">
                        <button
                          onClick={() => handleDeleteHackathon(h.id)}
                          className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {hackathons.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-surface-400">No hackathons found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Forms */}
          <div className="bg-white rounded-2xl border border-surface-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900">Forms ({forms.length})</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100">
                    <th className="text-left py-2 text-surface-500 font-medium">Title</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Creator</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Responses</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((f) => (
                    <tr key={f.id} className="border-b border-surface-50">
                      <td className="py-2 font-medium text-surface-900">{f.title}</td>
                      <td className="py-2 text-surface-600">{f.creator?.name || 'Unknown'}</td>
                      <td className="py-2 text-surface-600">{f.responses?.length || 0}</td>
                      <td className="py-2">
                        <button
                          onClick={() => handleDeleteForm(f.id)}
                          className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {forms.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-surface-400">No forms found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Colleges Tab (Super Admin) */}
      {activeTab === 'colleges' && isSuperAdmin && (
        <div className="space-y-6">
          {/* Pending Colleges */}
          {colleges.filter(c => c.status === 'PENDING').length > 0 && (
            <div className="bg-white rounded-2xl border border-surface-100 p-6">
              <h2 className="font-bold text-surface-900 mb-4 flex items-center gap-2">
                <Shield size={18} className="text-amber-500" />
                Pending Approval ({colleges.filter(c => c.status === 'PENDING').length})
              </h2>
              <div className="space-y-3">
                {colleges.filter(c => c.status === 'PENDING').map((c) => (
                  <div key={c.id} className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-surface-900">{c.name}</h3>
                        <p className="text-xs text-surface-500">Code: {c.code}</p>
                        {c.address && <p className="text-xs text-surface-500">{c.address}</p>}
                        {c.adminEmail && <p className="text-xs text-surface-500">Admin: {c.adminEmail}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleApproveCollege(c.id)}
                          className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-green-600">
                          <CheckCircle size={14} /> Approve
                        </button>
                        <button onClick={() => handleRejectCollege(c.id)}
                          className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-medium flex items-center gap-1 hover:bg-red-600">
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Colleges */}
          <div className="bg-white rounded-2xl border border-surface-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-surface-900">All Colleges ({colleges.length})</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {colleges.map((c) => (
                <div key={c.id} className={clsx('p-4 rounded-xl border',
                  c.status === 'APPROVED' ? 'bg-green-50 border-green-200' :
                  c.status === 'REJECTED' ? 'bg-red-50 border-red-200' :
                  'bg-surface-50 border-surface-100'
                )}>
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-surface-900">{c.name}</h3>
                    <button onClick={() => handleDeleteCollege(c.id)}
                      className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-surface-500 mb-2">Code: {c.code}</p>
                  {c.address && <p className="text-xs text-surface-500 mb-2">{c.address}</p>}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold',
                      c.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                      c.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    )}>
                      {c.status}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-surface-500">
                    <span>{c._count.users} users</span>
                    <span>{c._count.hackathons} hackathons</span>
                  </div>
                </div>
              ))}
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
              className="bg-white rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Add User</h2>
              <div className="space-y-3">
                <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="Name" />
                <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="Email" />
                <input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="Password (default: password123)" />
                <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm">
                  <option value="STUDENT">Student</option>
                  <option value="TEACHER">Teacher</option>
                  <option value="COLLEGE_ADMIN">College Admin</option>
                </select>
                <select value={newUser.departmentId} onChange={(e) => setNewUser({ ...newUser, departmentId: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm">
                  <option value="">Select department</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input type="text" value={newUser.studentId} onChange={(e) => setNewUser({ ...newUser, studentId: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="Student ID (optional)" />
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddUser(false)} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddUser} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium">Add</button>
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
              className="bg-white rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Add College</h2>
              <div className="space-y-3">
                <input type="text" value={newCollege.name} onChange={(e) => setNewCollege({ ...newCollege, name: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="College name" />
                <input type="text" value={newCollege.code} onChange={(e) => setNewCollege({ ...newCollege, code: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="College code (e.g., MIT)" />
                <input type="text" value={newCollege.address} onChange={(e) => setNewCollege({ ...newCollege, address: e.target.value })}
                  className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" placeholder="Address (optional)" />
              </div>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddCollege(false)} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddCollege} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium">Create</button>
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
              className="bg-white rounded-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Add Department</h2>
              <input type="text" value={newDept.name}
                onChange={(e) => setNewDept({ name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && handleAddDept()}
                className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                placeholder="e.g., Computer Science" autoFocus />
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowAddDept(false)} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium">Cancel</button>
                <button onClick={handleAddDept} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium">Create</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Calendar, BookOpen, Clock, TrendingUp, Bell, FileText,
  ChevronRight, Sparkles, Users, Target, Zap, Trophy,
  ClipboardList, GraduationCap, Shield, DoorOpen,
  ArrowUpRight, CheckCircle, AlertCircle, BarChart3, Plus,
} from 'lucide-react'
import clsx from 'clsx'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { dashboardAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'

// ─── Shared helpers ──────────────────────────────────────────────────────────
const hour = new Date().getHours()
const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06 } } }
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }

// ─── Stat Card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color, bg, loading }: {
  label: string; value: string | number; icon: any; color: string; bg: string; loading?: boolean
}) {
  return (
    <Card hover className="relative overflow-hidden group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-surface-500">{label}</p>
          <p className="text-3xl font-bold text-surface-900 mt-1">{loading ? '—' : value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform`}>
          <Icon size={22} />
        </div>
      </div>
      <div className={`absolute -bottom-8 -right-8 w-24 h-24 ${bg} rounded-full opacity-50 group-hover:opacity-80 transition-opacity`} />
    </Card>
  )
}

// ─── Quick Action Button ─────────────────────────────────────────────────────
function QuickAction({ label, icon: Icon, onClick }: { label: string; icon: any; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group text-left">
      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
        <Icon size={16} className="text-primary-600" />
      </div>
      <span className="text-sm font-medium text-surface-700 group-hover:text-primary-700 transition-colors">{label}</span>
      <ArrowUpRight size={14} className="ml-auto text-surface-300 group-hover:text-primary-500 transition-colors" />
    </button>
  )
}

// ─── Schedule type color map ─────────────────────────────────────────────────
const typeColor = (type: string) => {
  const m: Record<string, string> = { CLASS: 'primary', LAB: 'accent', SEMINAR: 'warning', OTHER: 'default' }
  return m[type] || 'default'
}

// ═════════════════════════════════════════════════════════════════════════════
// TEACHER DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function TeacherDashboard({ data, loading }: { data: any; loading: boolean }) {
  const navigate = useNavigate()

  const stats = [
    { label: 'My Courses', value: data?.totalCourses || 0, icon: BookOpen, color: 'from-blue-400 to-blue-600', bg: 'bg-blue-50' },
    { label: 'My Students', value: data?.totalStudents || 0, icon: Users, color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Hackathons', value: data?.activeHackathons || 0, icon: Trophy, color: 'from-purple-400 to-purple-600', bg: 'bg-purple-50' },
    { label: 'Active Forms', value: data?.activeForms || 0, icon: ClipboardList, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold text-surface-900">
          {greeting}, <span className="gradient-text">{useAuthStore.getState().user?.name?.split(' ')[0] || 'Teacher'}</span> 👋
        </h1>
        <p className="text-surface-500 mt-1">Manage your courses, hackathons, and forms</p>
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} />
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent Hackathons */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-bold text-surface-900">My Hackathons</h3>
                  <p className="text-xs text-surface-400">Hackathons you've created</p>
                </div>
              </div>
              <button onClick={() => navigate('/hackathons')} className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1">
                View all <ChevronRight size={12} />
              </button>
            </div>
            <div className="px-6 pb-6 space-y-3">
              {loading ? (
                <div className="text-center py-12 text-surface-400">Loading...</div>
              ) : !data?.recentHackathons?.length ? (
                <div className="text-center py-12">
                  <Trophy size={32} className="mx-auto text-surface-300 mb-3" />
                  <p className="text-surface-500 font-medium">No hackathons yet</p>
                  <p className="text-sm text-surface-400">Create your first hackathon to get started</p>
                </div>
              ) : (
                data.recentHackathons.map((h: any, i: number) => (
                  <motion.div key={h.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }}
                    onClick={() => navigate(`/hackathons/${h.id}`)}
                    className="flex items-center gap-4 p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors cursor-pointer group">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                      <Trophy size={18} className="text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-surface-900 group-hover:text-primary-700 transition-colors truncate">{h.title}</p>
                      <p className="text-xs text-surface-400 mt-0.5">
                        {h.startDate ? new Date(h.startDate).toLocaleDateString() : 'No date set'}
                      </p>
                    </div>
                    <Badge variant={h.status === 'PUBLISHED' ? 'success' : h.status === 'DRAFT' ? 'warning' : 'default'}>
                      {h.status}
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        {/* Quick Actions */}
        <motion.div variants={item} className="space-y-6">
          <Card className="bg-gradient-to-br from-primary-600 to-accent-600 text-white border-0">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={20} />
              <h3 className="font-bold">Quick Actions</h3>
            </div>
            <p className="text-sm text-white/80 mb-4">Jump to what you need</p>
            <div className="space-y-2">
              <button onClick={() => navigate('/hackathons')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <Trophy size={14} className="inline mr-2" />Create Hackathon
              </button>
              <button onClick={() => navigate('/forms')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <ClipboardList size={14} className="inline mr-2" />Create Form
              </button>
              <button onClick={() => navigate('/rooms')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <DoorOpen size={14} className="inline mr-2" />Manage Rooms
              </button>
              <button onClick={() => navigate('/schedule')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <Calendar size={14} className="inline mr-2" />View Schedule
              </button>
            </div>
          </Card>

          {/* Courses list */}
          <Card>
            <h3 className="font-bold text-surface-900 mb-4">My Courses</h3>
            <div className="space-y-3">
              {loading ? (
                <p className="text-sm text-surface-400">Loading...</p>
              ) : !data?.courses?.length ? (
                <div className="text-center py-4">
                  <BookOpen size={24} className="mx-auto text-surface-300 mb-2" />
                  <p className="text-sm text-surface-400">No courses assigned</p>
                </div>
              ) : (
                data.courses.map((c: any) => (
                  <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                      <BookOpen size={14} className="text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 truncate">{c.name}</p>
                      <p className="text-xs text-surface-400">{c.code}</p>
                    </div>
                    <Badge variant="default">{c.credits}cr</Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COLLEGE ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function CollegeAdminDashboard({ data, loading }: { data: any; loading: boolean }) {
  const navigate = useNavigate()

  const stats = [
    { label: 'Total Users', value: data?.totalUsers || 0, icon: Users, color: 'from-blue-400 to-blue-600', bg: 'bg-blue-50' },
    { label: 'Teachers', value: data?.totalTeachers || 0, icon: GraduationCap, color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Students', value: data?.totalStudents || 0, icon: BookOpen, color: 'from-purple-400 to-purple-600', bg: 'bg-purple-50' },
    { label: 'Hackathons', value: data?.hackathons || 0, icon: Trophy, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold text-surface-900">
          {greeting}, <span className="gradient-text">{useAuthStore.getState().user?.name?.split(' ')[0] || 'Admin'}</span> 👋
        </h1>
        <p className="text-surface-500 mt-1">Manage your college's users and content</p>
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} />
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Content Summary */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-bold text-surface-900">Content Overview</h3>
                  <p className="text-xs text-surface-400">Hackathons and forms in your college</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy size={16} className="text-purple-600" />
                    <span className="text-sm font-semibold text-purple-800">Hackathons</span>
                  </div>
                  <p className="text-2xl font-bold text-purple-900">{loading ? '—' : data?.hackathons || 0}</p>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200/50">
                  <div className="flex items-center gap-2 mb-2">
                    <ClipboardList size={16} className="text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">Forms</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-900">{loading ? '—' : data?.forms || 0}</p>
                </div>
              </div>

              {/* Recent Hackathons */}
              {!loading && data?.recentHackathons?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-surface-700 mb-3">Recent Hackathons</h4>
                  <div className="space-y-2">
                    {data.recentHackathons.map((h: any) => (
                      <div key={h.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors cursor-pointer"
                        onClick={() => navigate(`/hackathons/${h.id}`)}>
                        <Trophy size={14} className="text-purple-500 shrink-0" />
                        <span className="text-sm font-medium text-surface-900 truncate flex-1">{h.title}</span>
                        <Badge variant={h.status === 'PUBLISHED' ? 'success' : 'warning'}>{h.status}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* Quick Actions + Stats */}
        <motion.div variants={item} className="space-y-6">
          <Card className="bg-gradient-to-br from-primary-600 to-accent-600 text-white border-0">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={20} />
              <h3 className="font-bold">Quick Actions</h3>
            </div>
            <p className="text-sm text-white/80 mb-4">Jump to what you need</p>
            <div className="space-y-2">
              <button onClick={() => navigate('/admin/add-teachers')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <Users size={14} className="inline mr-2" />Add Teacher
              </button>
              <button onClick={() => navigate('/admin/add-students')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <BookOpen size={14} className="inline mr-2" />Add Student
              </button>
              <button onClick={() => navigate('/rooms')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <DoorOpen size={14} className="inline mr-2" />Manage Rooms
              </button>
              <button onClick={() => navigate('/admin')} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                <Shield size={14} className="inline mr-2" />Admin Panel
              </button>
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-surface-900 mb-3">College Stats</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50">
                <span className="text-sm text-surface-600">Admins</span>
                <span className="text-sm font-bold text-surface-900">{loading ? '—' : data?.totalAdmins || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50">
                <span className="text-sm text-surface-600">Teachers</span>
                <span className="text-sm font-bold text-surface-900">{loading ? '—' : data?.totalTeachers || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50">
                <span className="text-sm text-surface-600">Students</span>
                <span className="text-sm font-bold text-surface-900">{loading ? '—' : data?.totalStudents || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-surface-50">
                <span className="text-sm text-surface-600">Active Forms</span>
                <span className="text-sm font-bold text-surface-900">{loading ? '—' : data?.forms || 0}</span>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
function SuperAdminDashboard({ data, loading }: { data: any; loading: boolean }) {
  const navigate = useNavigate()

  const stats = [
    { label: 'Total Colleges', value: data?.totalColleges || 0, icon: GraduationCap, color: 'from-blue-400 to-blue-600', bg: 'bg-blue-50' },
    { label: 'Total Users', value: data?.totalUsers || 0, icon: Users, color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Pending Approvals', value: data?.pendingColleges || 0, icon: AlertCircle, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
    { label: 'Hackathons', value: data?.hackathons || 0, icon: Trophy, color: 'from-purple-400 to-purple-600', bg: 'bg-purple-50' },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold text-surface-900">
          {greeting}, <span className="gradient-text">{useAuthStore.getState().user?.name?.split(' ')[0] || 'Super Admin'}</span> 👋
        </h1>
        <p className="text-surface-500 mt-1">System-wide overview and management</p>
      </motion.div>

      {/* Stats */}
      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} />
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* System Overview */}
        <motion.div variants={item} className="lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="font-bold text-surface-900">System Overview</h3>
                  <p className="text-xs text-surface-400">All colleges and platform content</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200/50">
                  <GraduationCap size={16} className="text-blue-600 mb-2" />
                  <p className="text-xl font-bold text-blue-900">{loading ? '—' : data?.totalColleges || 0}</p>
                  <p className="text-xs text-blue-600">Colleges</p>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200/50">
                  <Users size={16} className="text-emerald-600 mb-2" />
                  <p className="text-xl font-bold text-emerald-900">{loading ? '—' : data?.totalUsers || 0}</p>
                  <p className="text-xs text-emerald-600">Users</p>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200/50">
                  <Trophy size={16} className="text-purple-600 mb-2" />
                  <p className="text-xl font-bold text-purple-900">{loading ? '—' : data?.hackathons || 0}</p>
                  <p className="text-xs text-purple-600">Hackathons</p>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200/50">
                  <ClipboardList size={16} className="text-amber-600 mb-2" />
                  <p className="text-xl font-bold text-amber-900">{loading ? '—' : data?.forms || 0}</p>
                  <p className="text-xs text-amber-600">Forms</p>
                </div>
              </div>

              {/* Pending colleges alert */}
              {!loading && data?.pendingColleges > 0 && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle size={16} className="text-amber-600" />
                    <span className="text-sm font-semibold text-amber-800">Pending College Approvals</span>
                  </div>
                  <p className="text-sm text-amber-700">{data.pendingColleges} college(s) awaiting approval</p>
                  <button onClick={() => navigate('/admin')} className="mt-2 text-xs font-semibold text-amber-800 hover:text-amber-900 underline">
                    Review now →
                  </button>
                </div>
              )}

              {/* User breakdown */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-surface-50 text-center">
                  <p className="text-lg font-bold text-surface-900">{loading ? '—' : data?.totalTeachers || 0}</p>
                  <p className="text-xs text-surface-500">Teachers</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 text-center">
                  <p className="text-lg font-bold text-surface-900">{loading ? '—' : data?.totalStudents || 0}</p>
                  <p className="text-xs text-surface-500">Students</p>
                </div>
                <div className="p-3 rounded-xl bg-surface-50 text-center">
                  <p className="text-lg font-bold text-surface-900">{loading ? '—' : data?.totalAdmins || 0}</p>
                  <p className="text-xs text-surface-500">Admins</p>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Quick Actions */}
        <motion.div variants={item} className="space-y-6">
          <Card className="bg-gradient-to-br from-primary-600 to-accent-600 text-white border-0">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={20} />
              <h3 className="font-bold">Quick Actions</h3>
            </div>
            <div className="space-y-3">
              <QuickAction label="Manage Colleges" icon={GraduationCap} onClick={() => navigate('/admin')} />
              <QuickAction label="View All Users" icon={Users} onClick={() => navigate('/admin')} />
              <QuickAction label="Register College" icon={Plus} onClick={() => navigate('/admin/register-college')} />
              <QuickAction label="Manage Rooms" icon={DoorOpen} onClick={() => navigate('/rooms')} />
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-surface-900 mb-3">Recent Activity</h3>
            <div className="space-y-2">
              {!loading && data?.recentHackathons?.length > 0 ? (
                data.recentHackathons.map((h: any) => (
                  <div key={h.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/hackathons/${h.id}`)}>
                    <Trophy size={12} className="text-purple-500 shrink-0" />
                    <span className="text-xs text-surface-700 truncate flex-1">{h.title}</span>
                    <span className="text-[10px] text-surface-400">{new Date(h.createdAt).toLocaleDateString()}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-surface-400 text-center py-4">No recent activity</p>
              )}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// STUDENT DASHBOARD (original, preserved)
// ═════════════════════════════════════════════════════════════════════════════
function StudentDashboard({ data, loading }: { data: any; loading: boolean }) {
  const navigate = useNavigate()

  const stats = [
    { label: 'CGPA', value: data?.cgpa?.toFixed(1) || '—', icon: TrendingUp, color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Attendance', value: `${data?.attendancePercent || 0}%`, icon: Target, color: 'from-primary-400 to-primary-600', bg: 'bg-primary-50' },
    { label: 'Assignments', value: `${data?.pendingAssignments || 0} Due`, icon: FileText, color: 'from-amber-400 to-amber-600', bg: 'bg-amber-50' },
    { label: 'Notifications', value: `${data?.unreadNotifications || 0} New`, icon: Bell, color: 'from-accent-400 to-accent-600', bg: 'bg-accent-50' },
  ]

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      <motion.div variants={item}>
        <h1 className="text-3xl font-bold text-surface-900">
          {greeting}, <span className="gradient-text">{useAuthStore.getState().user?.name?.split(' ')[0] || 'Student'}</span> 👋
        </h1>
        <p className="text-surface-500 mt-1">Here's your campus overview for today</p>
      </motion.div>

      <motion.div variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <StatCard key={stat.label} {...stat} loading={loading} />
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div variants={item} className="lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="p-6 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center"><Calendar className="w-5 h-5 text-primary-600" /></div>
                <div>
                  <h3 className="font-bold text-surface-900">Today's Schedule</h3>
                  <p className="text-xs text-surface-400">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 space-y-3">
              {loading ? (
                <div className="text-center py-12 text-surface-400">Loading schedule...</div>
              ) : data?.todaySchedule?.length === 0 ? (
                <div className="text-center py-12"><p className="text-surface-500 font-medium">No classes today</p><p className="text-sm text-surface-400">Enjoy your day off!</p></div>
              ) : (
                data?.todaySchedule?.map((event: any, i: number) => (
                  <motion.div key={event.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.1 }} className="flex items-center gap-4 p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors group cursor-pointer">
                    <div className="w-1 h-12 rounded-full" style={{ backgroundColor: event.color || '#5c7cfa' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-surface-900 group-hover:text-primary-700 transition-colors">{event.title}</p>
                        <Badge variant={typeColor(event.type) as any}>{event.type}</Badge>
                      </div>
                      <p className="text-sm text-surface-500 mt-0.5">{event.location}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1.5 text-surface-900 font-semibold"><Clock size={14} className="text-surface-400" />{event.startTime}</div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="space-y-6">
          <Card className="bg-gradient-to-br from-primary-600 to-accent-600 text-white border-0">
            <div className="flex items-center gap-2 mb-4"><Sparkles size={20} /><h3 className="font-bold">AI Assistant</h3></div>
            <p className="text-sm text-white/80 mb-4">What can I help you with today?</p>
            <div className="space-y-2">
              {['Summarize my notes', 'Check deadlines', 'Plan study schedule'].map((action) => (
                <button key={action} className="w-full text-left px-4 py-2.5 bg-white/10 backdrop-blur-sm rounded-xl text-sm font-medium hover:bg-white/20 transition-colors border border-white/10">
                  <Zap size={14} className="inline mr-2" />{action}
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="font-bold text-surface-900 mb-4">Recent Notifications</h3>
            <div className="space-y-3">
              {data?.recentNotifications?.slice(0, 4).map((n: any) => (
                <div key={n.id} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${n.type === 'EXAM' ? 'bg-red-100 text-red-600' : n.type === 'ASSIGNMENT' ? 'bg-primary-100 text-primary-600' : 'bg-accent-100 text-accent-600'}`}>
                    {n.type === 'EXAM' ? <FileText size={14} /> : n.type === 'ASSIGNMENT' ? <BookOpen size={14} /> : <Users size={14} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-700">{n.title}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD (role router)
// ═════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { user } = useAuthStore()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dashboardAPI.get().then(setData).catch(console.error).finally(() => setLoading(false))
  }, [])

  const role = user?.role || 'STUDENT'

  if (role === 'TEACHER') return <TeacherDashboard data={data} loading={loading} />
  if (role === 'COLLEGE_ADMIN') return <CollegeAdminDashboard data={data} loading={loading} />
  if (role === 'SUPER_ADMIN') return <SuperAdminDashboard data={data} loading={loading} />
  return <StudentDashboard data={data} loading={loading} />
}

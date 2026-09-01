import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI, departmentAPI } from '../lib/api'
import {
  ArrowLeft, Briefcase, Calendar, Users, ExternalLink, Download,
  Loader2, CheckCircle, Clock, Plus,
  Edit, Trash2, MapPin, Timer, DollarSign,
  Target, GraduationCap, BookOpen, CircleDot, Rocket, Printer,
  Lightbulb, Star, Zap, XCircle, Building2, Info, Shield, Link2, List
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { Department } from '../types/api'

export default function InternshipDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [internship, setInternship] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<any[]>([])
  const [showRegister, setShowRegister] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportStatus, setReportStatus] = useState('SELECTED')
  const [showRegistrations, setShowRegistrations] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isStudent = user?.role === 'STUDENT'
  const myRegistration = internship?.registrations?.find((r: any) => r.userId === user?.id)

  const handlePrint = () => window.print()

  useEffect(() => {
    if (id) loadInternship()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [id])

  const loadInternship = async () => {
    try {
      const data = await internshipAPI.getOne(id!)
      setInternship(data)
    } catch (err) {
      toast.error('Failed to load internship')
      navigate('/internships')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async () => {
    try {
      await internshipAPI.register(id!)
      toast.success('Registered successfully!')
      setShowRegister(false)
      loadInternship()
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to register')
    }
  }

  const handleReport = async () => {
    try {
      await internshipAPI.report(id!, reportStatus)
      toast.success('Status reported!')
      setShowReport(false)
      loadInternship()
    } catch (err) {
      toast.error('Failed to report status')
    }
  }

  const handleExport = async () => {
    try {
      const blob = await internshipAPI.exportOne(internship.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${internship.title.replace(/\s+/g, '_')}-registrations.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('Exported!')
    } catch (err) {
      toast.error('Export failed')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  if (!internship) return null

  const safeParse = (val: string): string[] => {
    if (!val) return []
    if (Array.isArray(val)) return val
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val)
        return Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        return val.trim() ? [val] : []
      }
    }
    return []
  }

  const targetDeptIds: string[] = safeParse(internship.targetDepartments)
  const targetYears: number[] = safeParse(internship.targetYears).map(Number)
  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const targetDeptNames = targetDeptIds.length > 0
    ? departments.filter(d => targetDeptIds.some(t => isUUID(t) ? t === d.id : t.toUpperCase() === d.name.toUpperCase())).map(d => d.name)
    : []

  const isEligible = !internship.eligibilityEnabled || (() => {
    if (!user || user.role !== 'STUDENT') return true
    if (targetDeptIds.length > 0 && (!user.departmentId || !targetDeptIds.some(t => isUUID(t) ? t === user.departmentId : t.toUpperCase() === (user.department?.name || '').toUpperCase()))) return false
    if (targetYears.length > 0 && user.incomingYear) {
      const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
      if (!targetYears.includes(currentYear)) return false
    }
    return true
  })()

  const getStatusBadge = () => {
    const now = new Date()
    const startDate = internship.startDate ? new Date(internship.startDate) : null
    const deadline = internship.deadline ? new Date(internship.deadline) : null
    if (internship.status === 'ENDED') return { label: 'Ended', color: 'bg-gray-700' }

    if (startDate) {
      if (now < startDate) return { label: 'Upcoming', color: 'bg-primary-600' }
      return { label: 'Active', color: 'bg-warning-600' }
    }
    if (deadline) {
      if (now < deadline) return { label: 'Upcoming', color: 'bg-primary-600' }
      return { label: 'Active', color: 'bg-warning-600' }
    }
    return { label: 'Upcoming', color: 'bg-primary-600' }
  }

  const statusBadge = getStatusBadge()

  const selectedCount = internship.registrations?.filter((r: any) => r.status === 'SELECTED').length || 0

  const tabs = [
    { key: 'overview', label: 'Overview', icon: Info },
    { key: 'eligibility', label: 'Eligibility', icon: Shield },
    { key: 'registrations', label: 'Registrations', icon: List },
  ]

  return (
    <div className="space-y-6">
      {/* Header — matching HackathonDetailPage style */}
      <div className="space-y-4">
        <button
          onClick={() => navigate('/internships')}
          className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:text-night-200 text-sm font-medium transition-colors"
        >
          <ArrowLeft size={16} /> Back to Internships
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-3 py-1 ${statusBadge.color} rounded-full text-xs font-semibold text-white`}>
                {statusBadge.label.toUpperCase()}
              </span>
              {internship.mode && (
                <span className="px-3 py-1 bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-300 rounded-full text-xs font-semibold">
                  {internship.mode}
                </span>
              )}
            </div>
            <h1 className="font-display text-xl md:text-2xl font-extrabold text-surface-900 dark:text-night-50 leading-none">{internship.title}</h1>
            {internship.company && (
              <p className="text-surface-500 dark:text-night-400 mt-1 flex items-center gap-2">
                <Building2 size={14} /> {internship.company}
              </p>
            )}
            {internship.role && (
              <p className="text-surface-400 dark:text-night-400 text-sm mt-1">{internship.role}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-surface-500 dark:text-night-400">
              <span className="flex items-center gap-1.5">
                <Users size={14} />
                {internship.registrations?.length || 0} Registered
              </span>
              {internship.deadline && (
                <span className="flex items-center gap-1.5">
                  <Clock size={14} />
                  Deadline: {new Date(internship.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
              {internship.stipend && (
                <span className="flex items-center gap-1.5">
                  <DollarSign size={14} />
                  {internship.stipend}
                </span>
              )}
              {internship.duration && (
                <span className="flex items-center gap-1.5">
                  <Timer size={14} />
                  {internship.duration}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            {internship.url && (
              <a href={internship.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-xl text-sm font-medium hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-colors">
                <ExternalLink size={14} /> Visit Website
              </a>
            )}
            {isTeacher && (
              <button onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-xl text-sm font-medium hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-colors">
                <Printer size={14} /> Print PDF
              </button>
            )}
            {isTeacher && (
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 border border-surface-200 dark:border-night-600 text-surface-700 dark:text-night-200 rounded-xl text-sm font-medium hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-colors">
                <Download size={14} /> Export Excel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-surface-200 dark:border-night-600 print:hidden">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                activeTab === key
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-surface-500 hover:text-surface-700 hover:border-surface-300'
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
              {/* About */}
              {internship.description && (
                <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-1 h-6 bg-gradient-to-b bg-primary-600 rounded-full" />
                    <h2 className="font-bold text-surface-900 dark:text-night-50 text-lg">About this Internship</h2>
                  </div>
                  <p className="text-surface-600 dark:text-night-300 leading-relaxed whitespace-pre-line">{internship.description}</p>
                </div>
              )}

              {/* Quick Info Bar — fixed: responsive grid prevents word/letter compression */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {internship.company && (
                  <div className="flex items-center gap-3 bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-3.5 sm:p-4 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                      <Building2 size={18} className="text-primary-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider leading-tight break-words">Company</p>
                      <p className="text-sm font-bold text-surface-900 dark:text-night-50 break-words leading-tight">{internship.company}</p>
                    </div>
                  </div>
                )}
                {internship.role && (
                  <div className="flex items-center gap-3 bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-3.5 sm:p-4 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Briefcase size={18} className="text-blue-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider leading-tight break-words">Role</p>
                      <p className="text-sm font-bold text-surface-900 dark:text-night-50 break-words leading-tight">{internship.role}</p>
                    </div>
                  </div>
                )}
                {internship.stipend && (
                  <div className="flex items-center gap-3 bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-3.5 sm:p-4 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-success-50 flex items-center justify-center shrink-0">
                      <DollarSign size={18} className="text-success-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider leading-tight break-words">Stipend</p>
                      <p className="text-sm font-bold text-surface-900 dark:text-night-50 break-words leading-tight">{internship.stipend}</p>
                    </div>
                  </div>
                )}
                {internship.duration && (
                  <div className="flex items-center gap-3 bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-3.5 sm:p-4 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-warning-50 flex items-center justify-center shrink-0">
                      <Timer size={18} className="text-warning-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider leading-tight break-words">Duration</p>
                      <p className="text-sm font-bold text-surface-900 dark:text-night-50 break-words leading-tight">{internship.duration}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Student Registration Card */}
              {isStudent && (
                <div
                  className="relative overflow-hidden rounded-2xl border-2 border-transparent bg-white dark:bg-night-800 p-6 print:hidden gradient-border-emerald">
                  {myRegistration ? (
                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                          <CheckCircle size={20} className="text-primary-500" />
                        </div>
                        <div>
                          <h3 className="font-bold text-surface-900 dark:text-night-50">Registered!</h3>
                          <p className="text-xs text-surface-400 dark:text-night-400">You're registered for this internship</p>
                        </div>
                      </div>
                      <div className="space-y-2.5 text-sm mb-4">
                        <div className="flex items-center justify-between p-2.5 bg-surface-50 dark:bg-night-800 rounded-xl">
                          <span className="text-surface-500 dark:text-night-400 font-medium">Status</span>
                          <span className={clsx('font-bold',
                            myRegistration.status === 'SELECTED' ? 'text-primary-600' :
                            myRegistration.status === 'REJECTED' ? 'text-danger-600' :
                            'text-primary-600'
                          )}>
                            {myRegistration.status}
                          </span>
                        </div>
                        {myRegistration.reportedAt && (
                          <div className="flex items-center justify-between p-2.5 bg-surface-50 dark:bg-night-800 rounded-xl">
                            <span className="text-surface-500 dark:text-night-400 font-medium">Reported At</span>
                            <span className="text-surface-900 dark:text-night-50 text-xs">{new Date(myRegistration.reportedAt).toLocaleDateString()}</span>
                          </div>
                        )}
                      </div>
                      <div className="pt-4 border-t border-surface-100 dark:border-night-600">
                        <p className="text-xs font-semibold text-surface-400 dark:text-night-400 uppercase tracking-wider mb-3">Self-Report Status</p>
                        <button
                          onClick={() => setShowReport(true)}
                          className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-primary-600 text-white hover:shadow-lg"
                        >
                          Report Status
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <Rocket size={28} className="text-white" />
                      </div>
                      <h3 className="font-bold text-surface-900 dark:text-night-50 text-lg mb-1">Apply for this Internship</h3>
                      <p className="text-surface-500 dark:text-night-400 text-sm mb-3">Register and track your application</p>
                      {internship.eligibilityEnabled && (
                        <div className={clsx('flex items-center gap-2 justify-center px-3 py-2 rounded-xl text-xs font-bold mb-4',
                          isEligible ? 'bg-primary-100 text-primary-700' : 'bg-danger-100 text-danger-700'
                        )}>
                          {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
                          {isEligible ? 'You are eligible' : 'Not eligible — check target departments & years'}
                        </div>
                      )}
                      <button
                        onClick={() => setShowRegister(true)}
                        disabled={internship.eligibilityEnabled && !isEligible}
                        className={clsx('w-full py-3 rounded-xl font-bold text-sm transition-all',
                          internship.eligibilityEnabled && !isEligible
                            ? 'bg-surface-200 text-surface-400 cursor-not-allowed'
                            : 'bg-primary-600 text-white hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]'
                        )}>
                        {internship.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Stats */}
              <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5 print:hidden">
                <h3 className="font-bold text-surface-900 dark:text-night-50 mb-4">Stats</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-500 dark:text-night-400">Total Registrations</span>
                    <span className="text-sm font-bold text-surface-900 dark:text-night-50">{internship.registrations?.length || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-surface-500 dark:text-night-400">Selected</span>
                    <span className="text-sm font-bold text-primary-600">{selectedCount}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'eligibility' && (
          <div className="max-w-3xl space-y-6">
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-6 bg-gradient-to-b from-accent-500 to-accent-500 rounded-full" />
                <h2 className="font-bold text-surface-900 dark:text-night-50 text-lg">Eligibility</h2>
              </div>
              {internship.eligibilityEnabled && (targetDeptNames.length > 0 || targetYears.length > 0) ? (
                <div className="space-y-3">
                  {targetDeptNames.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <GraduationCap size={14} className="text-accent-500 shrink-0" />
                      <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Departments:</span>
                      {targetDeptNames.map(name => (
                        <span key={name} className="px-2.5 py-0.5 bg-accent-100 text-accent-700 rounded-lg text-xs font-bold">{name}</span>
                      ))}
                    </div>
                  )}
                  {targetYears.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <BookOpen size={14} className="text-primary-500 shrink-0" />
                      <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Years:</span>
                      {targetYears.sort().map(y => (
                        <span key={y} className="px-2.5 py-0.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-bold">Year {y}</span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-surface-500 dark:text-night-400 text-sm">Open to all students</p>
              )}
            </div>

            {isStudent && internship.eligibilityEnabled && (
              <div className={clsx(
                'flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold',
                isEligible ? 'bg-primary-100 text-primary-700' : 'bg-danger-100 text-danger-700'
              )}>
                {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {isEligible ? 'You are eligible to register' : 'Not eligible — check target departments & years'}
              </div>
            )}
          </div>
        )}

        {activeTab === 'registrations' && isTeacher && (
          <div className="max-w-3xl">
            <button
              onClick={() => setShowRegistrations(true)}
              className="w-full bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5 flex items-center justify-between hover:shadow-md transition-all print:hidden"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                  <Users size={18} className="text-primary-500" />
                </div>
                <div className="text-left">
                  <h2 className="font-bold text-surface-900 dark:text-night-50 text-lg">Registrations</h2>
                  <p className="text-xs text-surface-400 dark:text-night-400">
                    {internship.registrations?.length === 0 ? 'No registrations yet' : `${internship.registrations?.length || 0} registered · ${selectedCount} selected`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {internship.registrations?.length > 0 && (
                  <>
                    <span className="px-2.5 py-1 bg-primary-100 text-primary-700 rounded-full text-xs font-bold">{internship.registrations.length}</span>
                    <span className="px-2.5 py-1 bg-primary-100 text-primary-700 rounded-full text-xs font-bold">{selectedCount}</span>
                  </>
                )}
                <ExternalLink size={16} className="text-surface-400 dark:text-night-400" />
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegister(false)}>
          <div className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Register for {internship.title}</h2>
            <p className="text-surface-600 dark:text-night-300 text-sm mb-4">By registering, you'll be added to the internship applicant list. You can report your status later.</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowRegister(false)} className="flex-1 px-4 py-2.5 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-semibold">Cancel</button>
               <button onClick={handleRegister} className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-semibold">Register</button>
            </div>
          </div>
        </div>
      )}

      {/* Report Status Modal */}
      {showReport && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowReport(false)}>
          <div className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Report Status</h2>
            <p className="text-surface-600 dark:text-night-300 text-sm mb-4">Let us know the outcome of your application.</p>
            <div className="space-y-3 mb-4">
              <button
                onClick={() => setReportStatus('SELECTED')}
                className={clsx('w-full p-3 rounded-xl text-sm font-semibold border-2 transition-all text-left',
                  reportStatus === 'SELECTED' ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-surface-200 text-surface-600 hover:border-surface-300'
                )}>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} />
                  <span>Selected / Offered</span>
                </div>
              </button>
              <button
                onClick={() => setReportStatus('REJECTED')}
                className={clsx('w-full p-3 rounded-xl text-sm font-semibold border-2 transition-all text-left',
                  reportStatus === 'REJECTED' ? 'border-danger-400 bg-danger-50 text-danger-700' : 'border-surface-200 text-surface-600 hover:border-surface-300'
                )}>
                <div className="flex items-center gap-2">
                  <XCircle size={16} />
                  <span>Rejected / Not Selected</span>
                </div>
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowReport(false)} className="flex-1 px-4 py-2.5 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-semibold">Cancel</button>
              <button onClick={handleReport} className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-semibold">Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Registrations Modal */}
      {showRegistrations && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegistrations(false)}>
          <div className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-surface-100 dark:border-night-600">
              <div className="flex items-center gap-3">
               <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
                   <Users size={18} className="text-primary-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-surface-900 dark:text-night-50">Registrations</h2>
                  <p className="text-sm text-surface-400 dark:text-night-400">{internship.registrations?.length || 0} registered · {selectedCount} selected</p>
                </div>
              </div>
              <button onClick={() => setShowRegistrations(false)} className="p-2 hover:bg-surface-100 dark:hover:bg-night-700 rounded-xl transition-colors">
                <XCircle size={20} className="text-surface-400 dark:text-night-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {!internship.registrations?.length ? (
                <div className="text-center py-12">
                  <Users size={48} className="text-surface-200 mx-auto mb-3" />
                  <p className="text-surface-400 dark:text-night-400 text-sm">No registrations yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-night-600">
                        <th className="text-left py-3 text-surface-500 dark:text-night-400 font-semibold text-xs uppercase tracking-wider">Roll No</th>
                        <th className="text-left py-3 text-surface-500 dark:text-night-400 font-semibold text-xs uppercase tracking-wider">Name</th>
                        <th className="text-left py-3 text-surface-500 dark:text-night-400 font-semibold text-xs uppercase tracking-wider">Email</th>
                        <th className="text-left py-3 text-surface-500 dark:text-night-400 font-semibold text-xs uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 text-surface-500 dark:text-night-400 font-semibold text-xs uppercase tracking-wider">Reported At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {internship.registrations.map((reg: any) => (
                        <tr key={reg.id} className="border-b border-surface-50 dark:border-night-600 hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 transition-colors">
                          <td className="py-3">
                            <span className="font-mono text-xs bg-surface-100 dark:bg-night-700 px-2 py-1 rounded-md text-surface-600 dark:text-night-300">{reg.user.studentId || '-'}</span>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2.5">
                               <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {reg.user.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-surface-900 dark:text-night-50">{reg.user.name}</p>
                                <p className="text-xs text-surface-400 dark:text-night-400">{reg.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-surface-600 dark:text-night-300 font-medium">{reg.user.email}</td>
                          <td className="py-3">
                            <span className={clsx('px-2.5 py-1 rounded-full text-xs font-bold',
                              reg.status === 'SELECTED' ? 'bg-primary-100 text-primary-700' :
                              reg.status === 'REJECTED' ? 'bg-danger-100 text-danger-700' :
                               'bg-primary-100 text-primary-700'
                            )}>
                              {reg.status}
                            </span>
                          </td>
                          <td className="py-3">
                            {reg.reportedAt ? (
                              <span className="text-xs text-surface-600 dark:text-night-300">{new Date(reg.reportedAt).toLocaleDateString()}</span>
                            ) : (
                              <span className="text-surface-300">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

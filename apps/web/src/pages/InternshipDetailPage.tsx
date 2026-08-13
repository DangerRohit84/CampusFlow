import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { internshipAPI, departmentAPI } from '../lib/api'
import {
  ArrowLeft, Briefcase, Calendar, Users, ExternalLink, Download,
  Loader2, CheckCircle, Clock, Plus,
  Edit, Trash2, MapPin, Timer, DollarSign,
  Target, GraduationCap, BookOpen, CircleDot, Rocket, Printer,
  Lightbulb, Star, Zap, XCircle, Building2
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
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-10 h-10 text-primary-500 animate-spin" />
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

    if (internship.status === 'ENDED') return { label: 'Ended', color: 'bg-gray-500' }
    if (startDate) {
      if (now < startDate) return { label: 'Upcoming', color: 'bg-blue-500' }
      return { label: 'Active', color: 'bg-green-500' }
    }
    if (deadline) {
      if (now < deadline) return { label: 'Upcoming', color: 'bg-blue-500' }
      return { label: 'Active', color: 'bg-green-500' }
    }
    return { label: 'Upcoming', color: 'bg-blue-500' }
  }

  const statusBadge = getStatusBadge()

  const selectedCount = internship.registrations?.filter((r: any) => r.status === 'SELECTED').length || 0

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-8 md:p-10 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-white rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
        </div>

        <div className="relative z-10">
          <button
            onClick={() => navigate('/internships')}
            className="flex items-center gap-2 text-white/70 hover:text-white text-sm font-medium mb-6 transition-colors print:hidden"
          >
            <ArrowLeft size={16} /> Back to Internships
          </button>

          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className={`px-3 py-1 ${statusBadge.color} rounded-full text-xs font-semibold tracking-wide`}>
                  {statusBadge.label}
                </span>
                {internship.mode && (
                  <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-semibold tracking-wide">
                    {internship.mode}
                  </span>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
                {internship.title}
              </h1>
              {internship.company && (
                <p className="text-white/80 text-lg flex items-center gap-2">
                  <Building2 size={18} /> {internship.company}
                </p>
              )}
              {internship.role && (
                <p className="text-white/70 text-sm mt-1">{internship.role}</p>
              )}
            </div>

            <div className="flex flex-wrap gap-3 print:hidden">
              {internship.url && (
                <a href={internship.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all">
                  <ExternalLink size={14} /> Apply Now
                </a>
              )}
              {isTeacher && (
                <button onClick={handlePrint}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all print:hidden">
                  <Printer size={14} /> Print PDF
                </button>
              )}
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all">
                <Download size={14} /> Export Excel
              </button>
            </div>
          </div>

          {/* Hero Stats */}
          <div className="flex flex-wrap gap-4 mt-6 print:hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm rounded-xl">
              <Users size={16} />
              <span className="text-sm font-bold">{internship.registrations?.length || 0}</span>
              <span className="text-xs text-white/70">Registered</span>
            </div>
            {internship.deadline && (
              <div className="flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm rounded-xl">
                <Clock size={16} />
                <span className="text-sm font-bold">Deadline: {new Date(internship.deadline).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Info Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {internship.company && (
          <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
              <Building2 size={18} className="text-blue-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Company</p>
              <p className="text-sm font-bold text-surface-900">{internship.company}</p>
            </div>
          </div>
        )}
        {internship.role && (
          <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
              <Briefcase size={18} className="text-purple-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Role</p>
              <p className="text-sm font-bold text-surface-900">{internship.role}</p>
            </div>
          </div>
        )}
        {internship.stipend && (
          <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
              <DollarSign size={18} className="text-green-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Stipend</p>
              <p className="text-sm font-bold text-surface-900">{internship.stipend}</p>
            </div>
          </div>
        )}
        {internship.duration && (
          <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <Timer size={18} className="text-amber-500" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Duration</p>
              <p className="text-sm font-bold text-surface-900">{internship.duration}</p>
            </div>
          </div>
        )}
      </div>

      {/* Registrations — Clickable Card (Teacher View) */}
      {isTeacher && (
        <button
          onClick={() => setShowRegistrations(true)}
          className="w-full bg-white rounded-2xl border border-surface-100 p-5 flex items-center justify-between hover:shadow-md transition-all print:hidden"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <Users size={18} className="text-indigo-500" />
            </div>
            <div className="text-left">
              <h2 className="font-bold text-surface-900 text-lg">Registrations</h2>
              <p className="text-xs text-surface-400">
                {internship.registrations?.length === 0 ? 'No registrations yet' : `${internship.registrations?.length || 0} registered · ${selectedCount} selected`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {internship.registrations?.length > 0 && (
              <>
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-bold">{internship.registrations.length}</span>
                <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">{selectedCount}</span>
              </>
            )}
            <ExternalLink size={16} className="text-surface-400" />
          </div>
        </button>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content — Left Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* About */}
          {internship.description && (
            <div className="bg-white rounded-2xl border border-surface-100 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
                <h2 className="font-bold text-surface-900 text-lg">About this Internship</h2>
              </div>
              <p className="text-surface-600 leading-relaxed whitespace-pre-line">{internship.description}</p>
            </div>
          )}

          {/* Eligibility */}
          <div className="bg-white rounded-2xl border border-surface-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
              <h2 className="font-bold text-surface-900 text-lg">Eligibility</h2>
            </div>

            {internship.eligibilityEnabled && (targetDeptNames.length > 0 || targetYears.length > 0) ? (
              <div className="space-y-2">
                {targetDeptNames.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <GraduationCap size={14} className="text-violet-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500">Departments:</span>
                    {targetDeptNames.map(name => (
                      <span key={name} className="px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-bold">{name}</span>
                    ))}
                  </div>
                )}
                {targetYears.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <BookOpen size={14} className="text-purple-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500">Years:</span>
                    {targetYears.sort().map(y => (
                      <span key={y} className="px-2.5 py-0.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">Year {y}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-surface-500 text-sm">Open to all students</p>
            )}
          </div>

          {/* Eligibility Popup for Students */}
          {isStudent && internship.eligibilityEnabled && (
            <div className={clsx(
              'flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold',
              isEligible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            )}>
              {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
              {isEligible ? 'You are eligible to register' : 'Not eligible — check target departments & years'}
            </div>
          )}
        </div>

        {/* Sidebar — Right Column */}
        <div className="space-y-4">
          {/* Student Registration Card */}
          {isStudent && (
            <div
              className="relative overflow-hidden rounded-2xl border-2 border-transparent bg-white p-6 print:hidden"
              style={{ backgroundImage: 'linear-gradient(white, white), linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box' }}>
              {myRegistration ? (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                      <CheckCircle size={20} className="text-green-500" />
                    </div>
                    <div>
                      <h3 className="font-bold text-surface-900">Registered!</h3>
                      <p className="text-xs text-surface-400">You're registered for this internship</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 text-sm mb-4">
                    <div className="flex items-center justify-between p-2.5 bg-surface-50 rounded-xl">
                      <span className="text-surface-500 font-medium">Status</span>
                      <span className={clsx('font-bold',
                        myRegistration.status === 'SELECTED' ? 'text-green-600' :
                        myRegistration.status === 'REJECTED' ? 'text-red-600' :
                        'text-blue-600'
                      )}>
                        {myRegistration.status}
                      </span>
                    </div>
                    {myRegistration.reportedAt && (
                      <div className="flex items-center justify-between p-2.5 bg-surface-50 rounded-xl">
                        <span className="text-surface-500 font-medium">Reported At</span>
                        <span className="text-surface-900 text-xs">{new Date(myRegistration.reportedAt).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-surface-100">
                    <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Self-Report Status</p>
                    <button
                      onClick={() => setShowReport(true)}
                      className="w-full py-3 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-primary-500 to-accent-500 text-white hover:shadow-lg"
                    >
                      Report Status
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
                    <Rocket size={28} className="text-white" />
                  </div>
                  <h3 className="font-bold text-surface-900 text-lg mb-1">Apply for this Internship</h3>
                  <p className="text-surface-500 text-sm mb-3">Register and track your application</p>

                  {internship.eligibilityEnabled && (
                    <div className={clsx('flex items-center gap-2 justify-center px-3 py-2 rounded-xl text-xs font-bold mb-4',
                      isEligible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
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
                        : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]'
                    )}>
                    {internship.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="bg-white rounded-2xl border border-surface-100 p-5 print:hidden">
            <h3 className="font-bold text-surface-900 mb-4">Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-blue-50 rounded-xl text-center">
                <p className="text-2xl font-extrabold text-blue-600">{internship.registrations?.length || 0}</p>
                <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mt-0.5">Registered</p>
              </div>
              <div className="p-3 bg-green-50 rounded-xl text-center">
                <p className="text-2xl font-extrabold text-green-600">{selectedCount}</p>
                <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mt-0.5">Selected</p>
              </div>
            </div>
          </div>

          {/* Company Info */}
          {internship.company && (
            <div className="bg-white rounded-2xl border border-surface-100 p-5 print:hidden">
              <h3 className="font-bold text-surface-900 mb-3">Company</h3>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center text-white text-sm font-bold">
                  {internship.company.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-surface-900 text-sm">{internship.company}</p>
                  <p className="text-xs text-surface-400">Internship Provider</p>
                </div>
              </div>
            </div>
          )}

          {/* Application Link */}
          {internship.url && (
            <div className="bg-white rounded-2xl border border-surface-100 p-5 print:hidden">
              <h3 className="font-bold text-surface-900 mb-3">Application</h3>
              <a href={internship.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-surface-50 hover:bg-surface-100 rounded-xl text-sm font-medium text-surface-700 transition-colors">
                <ExternalLink size={14} /> Apply on company website
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Register Modal */}
      {showRegister && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegister(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-surface-900 mb-4">Register for {internship.title}</h2>
            <p className="text-surface-600 text-sm mb-4">By registering, you'll be added to the internship applicant list. You can report your status later.</p>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowRegister(false)} className="flex-1 px-4 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-semibold">Cancel</button>
              <button onClick={handleRegister} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold">Register</button>
            </div>
          </div>
        </div>
      )}

      {/* Report Status Modal */}
      {showReport && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowReport(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-surface-900 mb-4">Report Status</h2>
            <p className="text-surface-600 text-sm mb-4">Let us know the outcome of your application.</p>
            <div className="space-y-3 mb-4">
              <button
                onClick={() => setReportStatus('SELECTED')}
                className={clsx('w-full p-3 rounded-xl text-sm font-semibold border-2 transition-all text-left',
                  reportStatus === 'SELECTED' ? 'border-green-400 bg-green-50 text-green-700' : 'border-surface-200 text-surface-600 hover:border-surface-300'
                )}>
                <div className="flex items-center gap-2">
                  <CheckCircle size={16} />
                  <span>Selected / Offered</span>
                </div>
              </button>
              <button
                onClick={() => setReportStatus('REJECTED')}
                className={clsx('w-full p-3 rounded-xl text-sm font-semibold border-2 transition-all text-left',
                  reportStatus === 'REJECTED' ? 'border-red-400 bg-red-50 text-red-700' : 'border-surface-200 text-surface-600 hover:border-surface-300'
                )}>
                <div className="flex items-center gap-2">
                  <XCircle size={16} />
                  <span>Rejected / Not Selected</span>
                </div>
              </button>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowReport(false)} className="flex-1 px-4 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-semibold">Cancel</button>
              <button onClick={handleReport} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-semibold">Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Registrations Modal */}
      {showRegistrations && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
          onClick={() => setShowRegistrations(false)}>
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-6 border-b border-surface-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                  <Users size={18} className="text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-surface-900">Registrations</h2>
                  <p className="text-sm text-surface-400">{internship.registrations?.length || 0} registered · {selectedCount} selected</p>
                </div>
              </div>
              <button onClick={() => setShowRegistrations(false)} className="p-2 hover:bg-surface-100 rounded-xl transition-colors">
                <XCircle size={20} className="text-surface-400" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {!internship.registrations?.length ? (
                <div className="text-center py-12">
                  <Users size={48} className="text-surface-200 mx-auto mb-3" />
                  <p className="text-surface-400 text-sm">No registrations yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100">
                        <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Roll No</th>
                        <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Name</th>
                        <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Email</th>
                        <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Reported At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {internship.registrations.map((reg: any) => (
                        <tr key={reg.id} className="border-b border-surface-50 hover:bg-surface-50 transition-colors">
                          <td className="py-3">
                            <span className="font-mono text-xs bg-surface-100 px-2 py-1 rounded-md text-surface-600">{reg.user.studentId || '-'}</span>
                          </td>
                          <td className="py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {reg.user.name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-surface-900">{reg.user.name}</p>
                                <p className="text-xs text-surface-400">{reg.user.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 text-surface-600 font-medium">{reg.user.email}</td>
                          <td className="py-3">
                            <span className={clsx('px-2.5 py-1 rounded-full text-xs font-bold',
                              reg.status === 'SELECTED' ? 'bg-green-100 text-green-700' :
                              reg.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            )}>
                              {reg.status}
                            </span>
                          </td>
                          <td className="py-3">
                            {reg.reportedAt ? (
                              <span className="text-xs text-surface-600">{new Date(reg.reportedAt).toLocaleDateString()}</span>
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
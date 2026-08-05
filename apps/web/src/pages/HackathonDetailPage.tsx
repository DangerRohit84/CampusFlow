import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI, departmentAPI } from '../lib/api'
import {
 ArrowLeft, Trophy, Calendar, Users, ExternalLink, Download,
 Loader2, Sparkles, CheckCircle, Clock, Plus, Award,
 Edit, Trash2, XCircle, ChevronUp, MapPin, Zap, DollarSign, Timer,
 Target, GraduationCap, BookOpen, Star, CircleDot, Rocket, Lightbulb, Printer
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function HackathonDetailPage() {
 const { id } = useParams<{ id: string }>()
 const { user } = useAuthStore()
 const navigate = useNavigate()
  const [hackathon, setHackathon] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState<any[]>([])
  const [showRegister, setShowRegister] = useState(false)
 const [showAddRound, setShowAddRound] = useState(false)
 const [form, setForm] = useState({ teamName: '', teamMembers: '', projectIdea: '' })
 const [roundForm, setRoundForm] = useState({ roundNumber: '1', title: '', description: '', date: '', resultDate: '' })
 const [editingRound, setEditingRound] = useState<string | null>(null)
 const [roundEditData, setRoundEditData] = useState({ title: '', description: '', date: '', resultDate: '' })

 const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
 const isStudent = user?.role === 'STUDENT'
 const myRegistration = hackathon?.registrations?.find((r: any) => r.userId === user?.id)

  const handlePrint = () => {
    window.print()
  }

  useEffect(() => {
    if (id) loadHackathon()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [id])

 const loadHackathon = async () => {
 try {
 const data = await hackathonAPI.getOne(id!)
 setHackathon(data)
 } catch (err) {
 toast.error('Failed to load hackathon')
 navigate('/hackathons')
 } finally {
 setLoading(false)
 }
 }

 const handleRegister = async () => {
 try {
 await hackathonAPI.register(id!, form)
 toast.success('Registered successfully!')
 setShowRegister(false)
 setForm({ teamName: '', teamMembers: '', projectIdea: '' })
 loadHackathon()
 } catch (err: any) {
 toast.error(err.response?.data?.error || 'Failed to register')
 }
 }

 const handleMarkSelected = async (round: number) => {
 if (!myRegistration) return
 try {
 await hackathonAPI.updateRound(id!, myRegistration.id, { round, status: 'SELECTED' })
 toast.success(`Marked as selected for Round ${round}!`)
 loadHackathon()
 } catch (err) {
 toast.error('Failed to update')
 }
 }

 const handleAddRound = async () => {
 try {
 await hackathonAPI.addRound(id!, roundForm)
 toast.success('Round added!')
 setShowAddRound(false)
 setRoundForm({ roundNumber: '1', title: '', description: '', date: '', resultDate: '' })
 loadHackathon()
 } catch (err) {
 toast.error('Failed to add round')
 }
 }

 const handleEditRound = (round: any) => {
 setEditingRound(round.id)
 setRoundEditData({ title: round.title, description: round.description || '', date: round.date || '', resultDate: round.resultDate || '' })
 }

 const handleSaveRound = async (roundId: string) => {
 try {
 await hackathonAPI.updateRoundDetails(hackathon!.id, roundId, roundEditData)
 toast.success('Round updated')
 setEditingRound(null)
 loadHackathon()
 } catch (err) { toast.error('Failed to update round') }
 }

 const handleDeleteRound = async (roundId: string) => {
 if (!confirm('Delete this round?')) return
 try {
 await hackathonAPI.deleteRound(hackathon!.id, roundId)
 toast.success('Round deleted')
 loadHackathon()
 } catch (err) { toast.error('Failed to delete round') }
 }

 const handleAdvanceStudent = async (regId: string, currentRound: number) => {
 try {
 await hackathonAPI.updateRegistrationStatus(hackathon!.id, regId, { currentRound: currentRound + 1, status: 'ACTIVE' })
 toast.success('Student advanced')
 loadHackathon()
 } catch (err) { toast.error('Failed to advance student') }
 }

 const handleEliminateStudent = async (regId: string, currentRound: number) => {
 try {
 await hackathonAPI.updateRegistrationStatus(hackathon!.id, regId, { currentRound, status: 'ELIMINATED' })
 toast.success('Student eliminated')
 loadHackathon()
 } catch (err) { toast.error('Failed to eliminate student') }
 }

 if (loading) {
 return (
 <div className="flex items-center justify-center h-[60vh]">
 <div
 >
 <Loader2 className="w-10 h-10 text-primary-500" />
 </div>
 </div>
 )
 }

 if (!hackathon) return null
 const safeParse = (val: any): any[] => {
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

 const parsedThemes = safeParse(hackathon.themes)
 const parsedBootcamps = safeParse(hackathon.bootcamps)
 const parsedHighlights = safeParse(hackathon.highlights)
  const selectedCount = hackathon.registrations.filter((r: any) => r.status === 'SELECTED').length
  const eliminatedCount = hackathon.registrations.filter((r: any) => r.status === 'ELIMINATED').length

  const targetDeptIds: string[] = safeParse(hackathon.targetDepartments)
  const targetYears: number[] = safeParse(hackathon.targetYears)
  const targetDeptNames = targetDeptIds.length > 0
    ? departments.filter(d => targetDeptIds.includes(d.id)).map(d => d.name)
    : []

  const isEligible = !hackathon.eligibilityEnabled || (() => {
    if (!user || user.role !== 'STUDENT') return true
    if (targetDeptIds.length > 0 && (!user.departmentId || !targetDeptIds.includes(user.departmentId))) return false
    if (targetYears.length > 0 && user.incomingYear) {
      const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
      if (!targetYears.includes(currentYear)) return false
    }
    return true
  })()

 return (
 <div className="space-y-6">
 {/* Hero Banner */}
 <div
 className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-8 md:p-10 text-white"
 >
 <div className="absolute inset-0 opacity-10">
 <div className="absolute top-0 right-0 w-96 h-96 bg-white rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
 <div className="absolute bottom-0 left-0 w-72 h-72 bg-white rounded-full blur-3xl translate-y-1/2 -translate-x-1/4" />
 <div className="absolute top-1/2 left-1/2 w-48 h-48 bg-white rounded-full blur-2xl -translate-x-1/2 -translate-y-1/2" />
 </div>

 <div className="relative z-10">
 <button
 onClick={() => navigate('/hackathons')}
 className="flex items-center gap-2 text-white/70 hover:text-white text-sm font-medium mb-6 transition-colors print:hidden"
 >
 <ArrowLeft size={16} />
 Back to Hackathons
 </button>

 <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
 <div className="flex-1">
 <div className="flex flex-wrap items-center gap-3 mb-3">
 {hackathon.mode && (
 <span className="px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-semibold tracking-wide">
 {hackathon.mode}
 </span>
 )}
 {hackathon.location && (
 <span className="flex items-center gap-1 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-medium">
 <MapPin size={12} /> {hackathon.location}
 </span>
 )}
 </div>
 <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-2">
 {hackathon.title}
 </h1>
 {hackathon.organizer && (
 <p className="text-white/80 text-lg">Organized by <span className="font-semibold text-white">{hackathon.organizer}</span></p>
 )}
 </div>

 <div className="flex flex-wrap gap-3 print:hidden">
 {hackathon.url && (
 <a href={hackathon.url} target="_blank" rel="noopener noreferrer"
 className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all">
 <ExternalLink size={14} /> Visit Website
 </a>
 )}
 {isTeacher && (
 <button
 onClick={handlePrint}
 className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all print:hidden"
 >
 <Printer size={14} /> Print PDF
 </button>
 )}
 <button
 onClick={() => hackathonAPI.exportOne(hackathon.id, `${hackathon.title.replace(/\s+/g, '_')}.xlsx`)}
 className="flex items-center gap-2 px-5 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-xl text-sm font-semibold hover:bg-white/30 transition-all"
 >
 <Download size={14} /> Export Excel
 </button>
 </div>
 </div>

 {/* Hero Stats */}
 <div className="flex flex-wrap gap-4 mt-6 print:hidden">
 <div className="flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm rounded-xl">
 <Users size={16} />
 <span className="text-sm font-bold">{hackathon.registrations.length}</span>
 <span className="text-xs text-white/70">Registered</span>
 </div>
 <div className="flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm rounded-xl">
 <Target size={16} />
 <span className="text-sm font-bold">{hackathon.rounds.length}</span>
 <span className="text-xs text-white/70">Rounds</span>
 </div>
 {hackathon.deadline && (
 <div className="flex items-center gap-2 px-4 py-2 bg-white/15 backdrop-blur-sm rounded-xl">
 <Clock size={16} />
 <span className="text-sm font-bold">Deadline: {new Date(hackathon.deadline).toLocaleDateString()}</span>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* Quick Info Bar */}
 <div
 className="grid grid-cols-2 md:grid-cols-4 gap-3"
 >
 {hackathon.startDate && (
 <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
 <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
 <Calendar size={18} className="text-blue-500" />
 </div>
 <div className="min-w-0">
 <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Starts</p>
 <p className="text-sm font-bold text-surface-900">{new Date(hackathon.startDate).toLocaleDateString()}</p>
 </div>
 </div>
 )}
 {hackathon.deadline && (
 <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
 <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
 <Clock size={18} className="text-red-500" />
 </div>
 <div className="min-w-0">
 <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Deadline</p>
 <p className="text-sm font-bold text-surface-900">{new Date(hackathon.deadline).toLocaleDateString()}</p>
 </div>
 </div>
 )}
 {hackathon.duration && (
 <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
 <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
 <Timer size={18} className="text-purple-500" />
 </div>
 <div className="min-w-0">
 <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Duration</p>
 <p className="text-sm font-bold text-surface-900">{hackathon.duration}</p>
 </div>
 </div>
 )}
 {hackathon.prizePool && (
 <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
 <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
 <DollarSign size={18} className="text-amber-500" />
 </div>
 <div className="min-w-0">
 <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Prize Pool</p>
 <p className="text-sm font-bold text-surface-900 break-words">{hackathon.prizePool}</p>
 </div>
 </div>
 )}
 {hackathon.teamSize && (
 <div className="flex items-center gap-3 bg-white rounded-2xl border border-surface-100 p-4 hover:shadow-md transition-shadow overflow-hidden">
 <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
 <Users size={18} className="text-emerald-500" />
 </div>
 <div className="min-w-0">
 <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider">Team Size</p>
 <p className="text-sm font-bold text-surface-900">{hackathon.teamSize} max</p>
 </div>
 </div>
 )}
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 {/* Main Content */}
 <div className="lg:col-span-2 space-y-6">
 {/* Description & Themes */}
 {hackathon.description && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-purple-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">About</h2>
 </div>
 <p className="text-surface-600 leading-relaxed">{hackathon.description}</p>

 {parsedThemes.length > 0 && (
 <div className="mt-5">
 <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Themes</p>
 <div className="flex flex-wrap gap-2">
 {parsedThemes.map((theme: string, i: number) => (
 <span key={i} className="px-4 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-full text-xs font-bold tracking-wide shadow-sm">
 {theme}
 </span>
 ))}
 </div>
 </div>
 )}
 </div>
 )}

 {/* Eligibility */}
 {hackathon.eligibility && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Eligibility</h2>
 </div>
 <div className="flex items-start gap-3 p-4 bg-emerald-50 rounded-xl">
 <CheckCircle size={18} className="text-emerald-500 shrink-0 mt-0.5" />
 <p className="text-surface-700 text-sm leading-relaxed">{hackathon.eligibility}</p>
 </div>
 </div>
 )}

 {/* Targeting */}
 {hackathon.eligibilityEnabled && (
 <div className="bg-white rounded-2xl border border-surface-100 p-6">
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-violet-500 to-purple-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Target Audience</h2>
 </div>
 <div className="space-y-3">
 {targetDeptNames.length > 0 && (
 <div className="flex items-center gap-2 flex-wrap">
 <GraduationCap size={16} className="text-violet-500 shrink-0" />
 <span className="text-xs font-semibold text-surface-500">Departments:</span>
 {targetDeptNames.map(name => (
 <span key={name} className="px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-bold">{name}</span>
 ))}
 </div>
 )}
 {targetYears.length > 0 && (
 <div className="flex items-center gap-2 flex-wrap">
 <BookOpen size={16} className="text-purple-500 shrink-0" />
 <span className="text-xs font-semibold text-surface-500">Years:</span>
 {targetYears.sort().map(y => (
 <span key={y} className="px-2.5 py-0.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">Year {y}</span>
 ))}
 </div>
 )}
 {targetDeptNames.length === 0 && targetYears.length === 0 && (
 <p className="text-sm text-surface-500">Open to all departments and years</p>
 )}
 </div>
 </div>
 )}

 {/* Schedule */}
 {hackathon.schedule && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-cyan-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Schedule</h2>
 </div>
 <div className="text-surface-600 text-sm leading-relaxed whitespace-pre-line">{hackathon.schedule}</div>
 </div>
 )}

 {/* Rounds Timeline */}
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center justify-between mb-6">
 <div className="flex items-center gap-2">
 <div className="w-1 h-6 bg-gradient-to-b from-orange-500 to-red-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Rounds</h2>
 </div>
 {isTeacher && (
 <button
 onClick={() => setShowAddRound(true)}
 className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl text-xs font-bold hover:shadow-lg transition-all print:hidden"
 >
 <Plus size={14} /> Add Round
 </button>
 )}
 </div>

 {hackathon.rounds.length === 0 ? (
 <div className="text-center py-8">
 <CircleDot size={32} className="text-surface-200 mx-auto mb-2" />
 <p className="text-surface-400 text-sm">No rounds defined yet</p>
 </div>
 ) : (
 <div className="relative">
 {/* Timeline line */}
 {hackathon.rounds.length > 1 && (
 <div className="absolute left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-orange-400 via-red-400 to-pink-400 hidden md:block" />
 )}

 <div className="space-y-4">
 {hackathon.rounds.map((round: any, idx: number) => {
 const isSelected = myRegistration && myRegistration.currentRound >= round.roundNumber
 const isLast = idx === hackathon.rounds.length - 1

 if (editingRound === round.id) {
 return (
 <div key={round.id} className="p-4 rounded-xl border border-surface-200 bg-surface-50 space-y-3 ml-0 md:ml-12">
 <input
 type="text"
 value={roundEditData.title}
 onChange={(e) => setRoundEditData({ ...roundEditData, title: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
 placeholder="Round title"
 />
 <textarea
 value={roundEditData.description}
 onChange={(e) => setRoundEditData({ ...roundEditData, description: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
 placeholder="Description"
 />
 <div className="grid grid-cols-2 gap-3">
 <input type="date" value={roundEditData.date} onChange={(e) => setRoundEditData({ ...roundEditData, date: e.target.value })} className="px-3 py-2 border border-surface-200 rounded-xl text-sm" />
 <input type="date" value={roundEditData.resultDate} onChange={(e) => setRoundEditData({ ...roundEditData, resultDate: e.target.value })} className="px-3 py-2 border border-surface-200 rounded-xl text-sm" />
 </div>
 <div className="flex gap-2">
 <button onClick={() => handleSaveRound(round.id)} className="px-4 py-2 bg-primary-500 text-white rounded-xl text-xs font-bold">Save</button>
 <button onClick={() => setEditingRound(null)} className="px-4 py-2 bg-surface-100 text-surface-600 rounded-xl text-xs font-bold">Cancel</button>
 </div>
 </div>
 )
 }

 return (
 <div key={round.id} className="relative flex gap-4">
 {/* Timeline node */}
 <div className="relative z-10 shrink-0">
 <div className={clsx(
 'w-10 h-10 rounded-full flex items-center justify-center text-sm font-extrabold shadow-md',
 isSelected ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white' :
 'bg-gradient-to-br from-surface-100 to-surface-200 text-surface-600'
 )}>
 {round.roundNumber}
 </div>
 </div>

 {/* Round content */}
 <div className={clsx(
 'flex-1 p-4 rounded-xl border transition-all hover:shadow-md',
 isSelected ? 'bg-green-50 border-green-200' : 'bg-surface-50 border-surface-100 hover:border-surface-200'
 )}>
 <div className="flex items-start justify-between gap-3">
 <div className="flex-1">
 <div className="flex items-center gap-2">
 <p className="font-bold text-surface-900">{round.title}</p>
 {isSelected && (
 <span className="px-2 py-0.5 bg-green-500 text-white rounded-full text-[10px] font-bold tracking-wider">
 SELECTED
 </span>
 )}
 </div>
 {round.description && (
 <p className="text-sm text-surface-500 mt-1.5 leading-relaxed">{round.description}</p>
 )}
 <div className="flex flex-wrap gap-3 mt-3">
 {round.date && (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium">
 <Calendar size={11} />
 {new Date(round.date).toLocaleDateString()}
 </span>
 )}
 {round.resultDate && (
 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium">
 <Trophy size={11} />
 Results: {new Date(round.resultDate).toLocaleDateString()}
 </span>
 )}
 </div>
 </div>
 <div className="flex items-center gap-1 shrink-0">
 {isSelected && <CheckCircle size={18} className="text-green-500 mr-1" />}
 {isTeacher && (
 <div className="print:hidden">
 <button onClick={() => handleEditRound(round)} className="p-1.5 text-surface-400 hover:text-primary-500 hover:bg-white rounded-lg transition-colors" title="Edit Round">
 <Edit size={14} />
 </button>
 <button onClick={() => handleDeleteRound(round.id)} className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-white rounded-lg transition-colors" title="Delete Round">
 <Trash2 size={14} />
 </button>
 </div>
 )}
 </div>
 </div>
 </div>
 </div>
 )
 })}
 </div>
 </div>
 )}
 </div>

 {/* Highlights */}
 {parsedHighlights.length > 0 && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-yellow-500 to-orange-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Highlights</h2>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
 {parsedHighlights.map((h: string, i: number) => (
 <div key={i} className="flex items-start gap-3 p-3 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-yellow-100">
 <Sparkles size={16} className="text-yellow-500 shrink-0 mt-0.5" />
 <p className="text-sm text-surface-700 leading-relaxed">{h}</p>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Bootcamps */}
 {parsedBootcamps.length > 0 && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-violet-500 to-purple-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Bootcamps</h2>
 </div>
 <div className="space-y-3">
 {parsedBootcamps.map((b: string, i: number) => (
 <div key={i} className="flex items-start gap-3 p-4 bg-violet-50 rounded-xl border border-violet-100">
 <GraduationCap size={18} className="text-violet-500 shrink-0 mt-0.5" />
 <p className="text-sm text-surface-700 leading-relaxed">{b}</p>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Registrations (Teacher View) */}
 {isTeacher && (
 <div
 className="bg-white rounded-2xl border border-surface-100 p-6 print:hidden"
 >
 <div className="flex items-center gap-2 mb-4">
 <div className="w-1 h-6 bg-gradient-to-b from-indigo-500 to-blue-500 rounded-full" />
 <h2 className="font-bold text-surface-900 text-lg">Registrations ({hackathon.registrations.length})</h2>
 </div>
 {hackathon.registrations.length === 0 ? (
 <div className="text-center py-8">
 <Users size={32} className="text-surface-200 mx-auto mb-2" />
 <p className="text-surface-400 text-sm">No registrations yet</p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-surface-100">
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Roll No</th>
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Name</th>
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Team</th>
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Status</th>
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Round</th>
 <th className="text-left py-3 text-surface-500 font-semibold text-xs uppercase tracking-wider">Actions</th>
 </tr>
 </thead>
 <tbody>
 {hackathon.registrations.map((reg: any) => (
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
 <td className="py-3 text-surface-600 font-medium">{reg.teamName || '-'}</td>
 <td className="py-3">
 <span className={clsx('px-2.5 py-1 rounded-full text-xs font-bold',
 reg.status === 'SELECTED' ? 'bg-green-100 text-green-700' :
 reg.status === 'ELIMINATED' ? 'bg-red-100 text-red-700' :
 'bg-blue-100 text-blue-700'
 )}>
 {reg.status}
 </span>
 </td>
 <td className="py-3">
 <span className="w-7 h-7 rounded-full bg-surface-100 flex items-center justify-center text-xs font-bold text-surface-700">
 {reg.currentRound}
 </span>
 </td>
 <td className="py-3 print:hidden">
 <div className="flex items-center gap-1">
 <button
 onClick={() => handleAdvanceStudent(reg.id, reg.currentRound)}
 disabled={reg.status === 'ELIMINATED' || reg.currentRound >= hackathon.rounds.length}
 className="p-1.5 text-surface-400 hover:text-green-500 hover:bg-green-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title="Advance to next round"
 >
 <ChevronUp size={14} />
 </button>
 <button
 onClick={() => handleEliminateStudent(reg.id, reg.currentRound)}
 disabled={reg.status === 'ELIMINATED'}
 className="p-1.5 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
 title="Eliminate student"
 >
 <XCircle size={14} />
 </button>
 </div>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )}
 </div>
 )}
 </div>

 {/* Sidebar */}
 <div className="space-y-4">
 {/* Student Registration Card */}
 {isStudent && (
 <div
 className="relative overflow-hidden rounded-2xl border-2 border-transparent bg-white p-6 print:hidden"
 style={{ backgroundImage: 'linear-gradient(white, white), linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899)', backgroundOrigin: 'border-box', backgroundClip: 'padding-box, border-box' }}
 >
 {myRegistration ? (
 <div>
 <div className="flex items-center gap-2 mb-4">
 <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
 <CheckCircle size={20} className="text-green-500" />
 </div>
 <div>
 <h3 className="font-bold text-surface-900">Registered!</h3>
 <p className="text-xs text-surface-400">You're in the hackathon</p>
 </div>
 </div>

 <div className="space-y-2.5 text-sm mb-4">
 {myRegistration.teamName && (
 <div className="flex items-center justify-between p-2.5 bg-surface-50 rounded-xl">
 <span className="text-surface-500 font-medium">Team</span>
 <span className="font-bold text-surface-900">{myRegistration.teamName}</span>
 </div>
 )}
 <div className="flex items-center justify-between p-2.5 bg-surface-50 rounded-xl">
 <span className="text-surface-500 font-medium">Status</span>
 <span className={clsx('font-bold',
 myRegistration.status === 'SELECTED' ? 'text-green-600' :
 myRegistration.status === 'ELIMINATED' ? 'text-red-600' :
 'text-blue-600'
 )}>
 {myRegistration.status}
 </span>
 </div>
 <div className="flex items-center justify-between p-2.5 bg-surface-50 rounded-xl">
 <span className="text-surface-500 font-medium">Current Round</span>
 <span className="font-bold text-surface-900">{myRegistration.currentRound}</span>
 </div>
 </div>

 {hackathon.rounds.length > 0 && (
 <div className="pt-4 border-t border-surface-100">
 <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Self-Report Progress</p>
 <div className="space-y-2">
 {hackathon.rounds.map((round: any) => {
 const isCompleted = myRegistration.currentRound >= round.roundNumber
 const isNext = myRegistration.currentRound === round.roundNumber - 1
 return (
 <button
 key={round.id}
 onClick={() => handleMarkSelected(round.roundNumber)}
 disabled={!isNext}
 className={clsx('w-full flex items-center gap-2.5 p-3 rounded-xl text-sm font-semibold transition-all',
 isCompleted ? 'bg-green-50 text-green-700 border border-green-200' :
 isNext ? 'bg-gradient-to-r from-primary-500 to-accent-500 text-white hover:shadow-lg' :
 'bg-surface-50 text-surface-400 border border-surface-100 cursor-not-allowed'
 )}
 >
 {isCompleted ? <CheckCircle size={16} /> : isNext ? <Rocket size={16} /> : <Clock size={16} />}
 {isCompleted ? `Round ${round.roundNumber} — Selected` : `Mark: Round ${round.roundNumber}`}
 </button>
 )
 })}
 </div>
 </div>
 )}
 </div>
  ) : (
  <div className="text-center">
  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
  <Rocket size={28} className="text-white" />
  </div>
  <h3 className="font-bold text-surface-900 text-lg mb-1">Join this Hackathon</h3>
  <p className="text-surface-500 text-sm mb-3">Register your team and start building</p>

  {hackathon.eligibilityEnabled && (
    <div className={clsx('flex items-center gap-2 justify-center px-3 py-2 rounded-xl text-xs font-bold mb-4',
      isEligible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    )}>
      {isEligible ? <CheckCircle size={14} /> : <XCircle size={14} />}
      {isEligible ? 'You are eligible' : 'Not eligible — check target departments & years'}
    </div>
  )}

  <button
  onClick={() => setShowRegister(true)}
  disabled={hackathon.eligibilityEnabled && !isEligible}
  className={clsx('w-full py-3 rounded-xl font-bold text-sm transition-all',
    hackathon.eligibilityEnabled && !isEligible
      ? 'bg-surface-200 text-surface-400 cursor-not-allowed'
      : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]'
  )}
  >
  {hackathon.eligibilityEnabled && !isEligible ? 'Not Eligible' : 'Register Now'}
  </button>
  </div>
  )}
 </div>
 )}

 {/* Stats */}
 <div
 className="bg-white rounded-2xl border border-surface-100 p-5 print:hidden"
 >
 <h3 className="font-bold text-surface-900 mb-4">Stats</h3>
 <div className="grid grid-cols-2 gap-3">
 <div className="p-3 bg-blue-50 rounded-xl text-center">
 <p className="text-2xl font-extrabold text-blue-600">{hackathon.registrations.length}</p>
 <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mt-0.5">Registered</p>
 </div>
 <div className="p-3 bg-purple-50 rounded-xl text-center">
 <p className="text-2xl font-extrabold text-purple-600">{hackathon.rounds.length}</p>
 <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mt-0.5">Rounds</p>
 </div>
 <div className="p-3 bg-green-50 rounded-xl text-center">
 <p className="text-2xl font-extrabold text-green-600">{selectedCount}</p>
 <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mt-0.5">Selected</p>
 </div>
 <div className="p-3 bg-red-50 rounded-xl text-center">
 <p className="text-2xl font-extrabold text-red-600">{eliminatedCount}</p>
 <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mt-0.5">Eliminated</p>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Register Modal */}
 {showRegister && (
 <div
 className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
 onClick={() => setShowRegister(false)}
 >
 <div
 className="bg-white rounded-2xl w-full max-w-md p-6"
 onClick={(e) => e.stopPropagation()}
 >
 <h2 className="text-xl font-bold text-surface-900 mb-4">Register for {hackathon.title}</h2>
 <div className="space-y-3">
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Team Name</label>
 <input
 type="text"
 value={form.teamName}
 onChange={(e) => setForm({ ...form, teamName: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
 placeholder="Your team name"
 />
 </div>
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Team Members</label>
 <textarea
 value={form.teamMembers}
 onChange={(e) => setForm({ ...form, teamMembers: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
 placeholder="Name1, Name2, Name3..."
 />
 </div>
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Project Idea (optional)</label>
 <textarea
 value={form.projectIdea}
 onChange={(e) => setForm({ ...form, projectIdea: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
 placeholder="Brief project idea..."
 />
 </div>
 </div>
 <div className="flex gap-3 mt-5">
 <button onClick={() => setShowRegister(false)} className="flex-1 px-4 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-semibold">
 Cancel
 </button>
 <button onClick={handleRegister} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-xl font-semibold">
 Register
 </button>
 </div>
 </div>
 </div>
 )}

 {/* Add Round Modal */}
 {showAddRound && (
 <div
 className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 print:hidden"
 onClick={() => setShowAddRound(false)}
 >
 <div
 className="bg-white rounded-2xl w-full max-w-md p-6"
 onClick={(e) => e.stopPropagation()}
 >
 <h2 className="text-xl font-bold text-surface-900 mb-4">Add Round</h2>
 <div className="space-y-3">
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Round Number</label>
 <input
 type="number"
 value={roundForm.roundNumber}
 onChange={(e) => setRoundForm({ ...roundForm, roundNumber: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
 />
 </div>
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Title</label>
 <input
 type="text"
 value={roundForm.title}
 onChange={(e) => setRoundForm({ ...roundForm, title: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
 placeholder="Round 1"
 />
 </div>
 </div>
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
 <textarea
 value={roundForm.description}
 onChange={(e) => setRoundForm({ ...roundForm, description: e.target.value })}
 className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
 placeholder="What happens in this round"
 />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Date</label>
 <input type="date" value={roundForm.date} onChange={(e) => setRoundForm({ ...roundForm, date: e.target.value })} className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" />
 </div>
 <div>
 <label className="text-sm font-medium text-surface-700 mb-1 block">Results Date</label>
 <input type="date" value={roundForm.resultDate} onChange={(e) => setRoundForm({ ...roundForm, resultDate: e.target.value })} className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm" />
 </div>
 </div>
 </div>
 <div className="flex gap-3 mt-5">
 <button onClick={() => setShowAddRound(false)} className="flex-1 px-4 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-semibold">
 Cancel
 </button>
 <button onClick={handleAddRound} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold">
 Add Round
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 )
}

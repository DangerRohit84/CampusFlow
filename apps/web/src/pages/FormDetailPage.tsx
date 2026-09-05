import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { formAPI, departmentAPI } from '../lib/api'
import { motion } from 'framer-motion'
import { ArrowLeft, FileText, Users, Download, Loader2, CheckCircle, Send, Clock, Plus, GraduationCap, BookOpen, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import type { Department } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'

export default function FormDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [form, setForm] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<any>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [extendDays, setExtendDays] = useState('7')
  const [departments, setDepartments] = useState<Department[]>([])
  const [editingFields, setEditingFields] = useState(false)
  const [editFields, setEditFields] = useState<any[]>([])
  const [savingFields, setSavingFields] = useState(false)

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isCRofLinkedRoom = user?.role === 'STUDENT' && form?.formRooms?.some(
    (fr: any) => fr.room.members?.some((m: any) => m.studentId === user.id && m.isCR)
  )
  const canEdit = isTeacher || isCRofLinkedRoom
  const isExpired = form?.expiresAt && new Date() > new Date(form.expiresAt)

  // Eligibility computation
  const safeParse = (json: unknown): string[] => {
    try {
      if (Array.isArray(json)) return json
      if (typeof json === 'string') return JSON.parse(json || '[]')
      return []
    } catch { return [] }
  }

  const targetDeptIds: string[] = safeParse(form?.targetDepartments)
  const targetYearsList: number[] = safeParse(form?.targetYears).map(Number)
  const targetDeptNames = targetDeptIds.length > 0 && departments.length > 0
    ? departments.filter(d => targetDeptIds.includes(d.id)).map(d => d.name)
    : []

  const formRooms = form?.formRooms || []

  const isEligible = (() => {
    if (!user || user.role !== 'STUDENT') return true
    
    // Check room-based eligibility
    if (formRooms.length > 0) {
      // Backend handles actual room membership check, but for UI we show the form
      // The backend will reject if not a member
      return true
    }
    
    // Check department/year eligibility
    if (!form?.eligibilityEnabled) return true
    if (targetDeptIds.length > 0 && (!user.departmentId || !targetDeptIds.includes(user.departmentId))) return false
    if (targetYearsList.length > 0 && user.incomingYear) {
      const currentYear = Math.min(new Date().getFullYear() - user.incomingYear + 1, 4)
      if (!targetYearsList.includes(currentYear)) return false
    }
    return true
  })()

  useEffect(() => {
    if (id) loadForm()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
  }, [id])

  const loadForm = async () => {
    try {
      const data = await formAPI.getOne(id!)
      setForm(data)
      
      // Pre-fill answers if already responded
      const response = data.responses?.find((r: any) => r.userId === user?.id)
      if (response) {
        setAnswers(JSON.parse(response.answers))
        setSubmitted(true)
      }
    } catch (err) {
      toast.error('Failed to load form')
      navigate('/forms')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    // Validate required fields
    for (const field of form.fields) {
      if (field.required && !answers[field.id]) {
        toast.error(`"${field.label}" is required`)
        return
      }
    }

    setSubmitting(true)
    try {
      await formAPI.respond(id!, answers)
      toast.success(submitted ? 'Response updated!' : 'Response submitted!')
      setSubmitted(true)
      loadForm()
    } catch (err) {
      toast.error('Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const handleExtend = async () => {
    const days = parseInt(extendDays) || 7
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + days)

    try {
      await formAPI.extend(id!, newExpiry.toISOString())
      toast.success(`Extended by ${days} days`)
      loadForm()
    } catch (err) {
      toast.error('Failed to extend')
    }
  }

  const startEditFields = () => {
    setEditFields(form.fields.map((f: any) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options: (() => { try { return JSON.parse(f.options || '[]') } catch { return [] } })(),
    })))
    setEditingFields(true)
  }

  const addEditField = () => {
    setEditFields([...editFields, { label: '', type: 'TEXT', required: false, options: [] }])
  }

  const updateEditField = (index: number, updates: any) => {
    const updated = [...editFields]
    updated[index] = { ...updated[index], ...updates }
    setEditFields(updated)
  }

  const removeEditField = (index: number) => {
    if (editFields.length <= 1) return
    setEditFields(editFields.filter((_: any, i: number) => i !== index))
  }

  const saveFields = async () => {
    const valid = editFields.filter((f: any) => f.label)
    if (valid.length === 0) {
      toast.error('Need at least one field')
      return
    }
    setSavingFields(true)
    try {
      await formAPI.updateFields(id!, valid)
      toast.success('Fields updated!')
      setEditingFields(false)
      loadForm()
    } catch (err) {
      toast.error('Failed to update fields')
    } finally {
      setSavingFields(false)
    }
  }

  const getFieldIcon = (type: string) => {
    switch (type) {
      case 'TEXT': return '📝'
      case 'TEXTAREA': return '📄'
      case 'SELECT': return '📋'
      case 'RADIO': return '🔘'
      case 'CHECKBOX': return '☑️'
      case 'NUMBER': return '🔢'
      case 'EMAIL': return '📧'
      case 'DATE': return '📅'
      case 'RATING': return '⭐'
      default: return '📝'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  if (!form) return null

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<ClipboardList size={18} />}
        eyebrow="Form · Detail"
        title={<>Form Detail</>}
        subtitle="Responses, analytics and submissions — everything in one bento."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/forms')} className="p-2 rounded-xl bg-surface-100 dark:bg-night-700 hover:bg-surface-200 transition-all">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">{form.title}</h1>
          {form.description && <p className="text-surface-500 dark:text-night-400 text-sm mt-1">{form.description}</p>}
        </div>
        <div className="flex gap-2">
          {isTeacher && (
            <button
              onClick={() => formAPI.exportOne(form.id, `${form.title.replace(/\s+/g, '_')}_responses.xlsx`)}
              className="flex items-center gap-2 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl hover:bg-surface-200 text-sm font-medium"
            >
              <Download size={14} /> Export
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {isTeacher ? (
            /* Teacher View: Responses */
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
              <h2 className="font-bold text-surface-900 dark:text-night-50 mb-4">Responses ({form.responses.length})</h2>
              {form.responses.length === 0 ? (
                <p className="text-surface-400 dark:text-night-400 text-sm">No responses yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-100 dark:border-night-600">
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Roll No</th>
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Student</th>
                        {form.fields.map((f: any) => (
                          <th key={f.id} className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">{f.label}</th>
                        ))}
                        <th className="text-left py-2 text-surface-500 dark:text-night-400 font-medium">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.responses.map((resp: any) => {
                        const answersData = JSON.parse(resp.answers)
                        return (
                          <tr key={resp.id} className="border-b border-surface-50 dark:border-night-600">
                            <td className="py-2 font-mono text-xs text-surface-600 dark:text-night-300">{resp.user.studentId || '-'}</td>
                            <td className="py-2">
                              <p className="font-medium text-surface-900 dark:text-night-50">{resp.user.name}</p>
                              <p className="text-xs text-surface-400 dark:text-night-400">{resp.user.email}</p>
                            </td>
                            {form.fields.map((f: any) => (
                              <td key={f.id} className="py-2 text-surface-600 dark:text-night-300">
                                {answersData[f.id] || '-'}
                              </td>
                            ))}
                            <td className="py-2 text-xs text-surface-400 dark:text-night-400">
                              {new Date(resp.submittedAt).toLocaleDateString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            /* Student View: Fill Form */
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-6">
              {submitted && (
                <div className="mb-4 p-3 bg-primary-50 rounded-xl border border-primary-200 flex items-center gap-2">
                  <CheckCircle size={18} className="text-primary-500" />
                  <span className="text-sm text-primary-700 font-medium">You've already submitted. You can update your response.</span>
                </div>
              )}

              {!isEligible && (
                <div className="mb-4 p-3 bg-danger-50 rounded-xl border border-danger-200 flex items-center gap-2">
                  <span className="text-sm text-danger-700 font-medium">You are not eligible to respond to this form.</span>
                </div>
              )}

              <div className="space-y-4">
                {form.fields.map((field: any) => (
                  <div key={field.id}>
                    <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">
                      {field.label}
                      {field.required && <span className="text-danger-500 ml-1">*</span>}
                    </label>
                    
                    {field.type === 'TEXT' && (
                      <input
                        type="text"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    )}
                    
                    {field.type === 'TEXTAREA' && (
                      <textarea
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm h-24"
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                      />
                    )}
                    
                    {field.type === 'NUMBER' && (
                      <input
                        type="number"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder="Enter number"
                      />
                    )}
                    
                    {field.type === 'EMAIL' && (
                      <input
                        type="email"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                        placeholder="Enter email"
                      />
                    )}
                    
                    {field.type === 'DATE' && (
                      <input
                        type="date"
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                      />
                    )}
                    
                    {field.type === 'SELECT' && (
                      <select
                        value={answers[field.id] || ''}
                        onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                        className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                      >
                        <option value="">Select...</option>
                        {field.options?.map((opt: string) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    )}
                    
                    {field.type === 'RADIO' && (
                      <div className="space-y-2">
                        {field.options?.map((opt: string) => (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={field.id}
                              value={opt}
                              checked={answers[field.id] === opt}
                              onChange={(e) => setAnswers({ ...answers, [field.id]: e.target.value })}
                              className="text-primary-500"
                            />
                            <span className="text-sm text-surface-700 dark:text-night-200">{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    
                    {field.type === 'CHECKBOX' && (
                      <div className="space-y-2">
                        {field.options?.map((opt: string) => (
                          <label key={opt} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(answers[field.id] || '').includes(opt)}
                              onChange={(e) => {
                                const current = answers[field.id] || ''
                                const updated = e.target.checked
                                  ? (current ? current + ', ' + opt : opt)
                                  : current.replace(opt, '').replace(', ', ', ').replace(/^,|,$/g, '')
                                setAnswers({ ...answers, [field.id]: updated })
                              }}
                              className="text-primary-500 rounded"
                            />
                            <span className="text-sm text-surface-700 dark:text-night-200">{opt}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {isExpired && !submitted ? (
                <div className="mt-6 p-4 bg-danger-50 rounded-xl text-center">
                  <Clock size={24} className="mx-auto text-danger-500 mb-2" />
                  <p className="text-sm font-medium text-danger-700">Form has expired</p>
                  <p className="text-xs text-danger-500">Expired on {new Date(form.expiresAt).toLocaleString()}</p>
                </div>
              ) : !isEligible ? (
                <div className="mt-6 p-4 bg-danger-50 rounded-xl text-center">
                  <p className="text-sm font-medium text-danger-700">You are not eligible to respond to this form</p>
                </div>
              ) : !submitted || form.allowEdit ? (
                <button
                  onClick={handleSubmit}
                  disabled={submitting || isExpired}
                  className="mt-6 w-full py-3 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {submitted ? 'Update Response' : 'Submit Response'}
                </button>
              ) : (
                <div className="mt-6 p-4 bg-surface-50 dark:bg-night-800 rounded-xl text-center">
                  <CheckCircle size={24} className="mx-auto text-primary-500 mb-2" />
                  <p className="text-sm font-medium text-surface-700 dark:text-night-200">You've already submitted</p>
                  <p className="text-xs text-surface-400 dark:text-night-400">Editing is not allowed for this form</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
            <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Form Info</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Fields</span>
                <span className="font-bold text-surface-900 dark:text-night-50">{form.fields.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Responses</span>
                <span className="font-bold text-surface-900 dark:text-night-50">{form.responses.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Created by</span>
                <span className="font-medium text-surface-700 dark:text-night-200">{form.creator.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Created</span>
                <span className="text-surface-700 dark:text-night-200">{new Date(form.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Edit responses</span>
                <span className={clsx('font-medium', form.allowEdit ? 'text-primary-600' : 'text-danger-500')}>
                  {form.allowEdit ? 'Allowed' : 'Locked'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-surface-500 dark:text-night-400">Expires</span>
                {form.expiresAt ? (
                  <span className={clsx('font-medium text-xs', isExpired ? 'text-danger-500' : 'text-warning-600')}>
                    {isExpired ? 'Expired' : new Date(form.expiresAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="font-medium text-surface-400 dark:text-night-400 text-xs">Never</span>
                )}
              </div>
            </div>
          </div>

          {/* Targeting Badges */}
          {form.eligibilityEnabled && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Target Audience</h3>
              <div className="space-y-3">
                {targetDeptNames.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <GraduationCap size={14} className="text-accent-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Departments:</span>
                    {targetDeptNames.map(name => (
                      <span key={name} className="px-2 py-0.5 bg-accent-100 text-accent-700 rounded-lg text-xs font-bold">{name}</span>
                    ))}
                  </div>
                )}
                {targetYearsList.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <BookOpen size={14} className="text-primary-500 shrink-0" />
                    <span className="text-xs font-semibold text-surface-500 dark:text-night-400">Years:</span>
                    {targetYearsList.sort().map(y => (
                      <span key={y} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-lg text-xs font-bold">Year {y}</span>
                    ))}
                  </div>
                )}
                {targetDeptNames.length === 0 && targetYearsList.length === 0 && (
                  <p className="text-xs text-surface-500 dark:text-night-400">Open to all departments and years</p>
                )}
              </div>
            </div>
          )}

          {form.formRooms && form.formRooms.length > 0 && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Linked Rooms</h3>
              <div className="flex flex-wrap gap-2">
                {form.formRooms.map((fr: any) => (
                  <span key={fr.room.id} className="px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                    🏠 {fr.room.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {canEdit && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-surface-900 dark:text-night-50">Form Fields</h3>
                {!editingFields ? (
                  <button onClick={startEditFields} className="text-xs font-semibold text-primary-600 hover:text-primary-700">Edit</button>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={() => setEditingFields(false)} className="text-xs font-semibold text-surface-500 hover:text-surface-700 dark:text-night-200">Cancel</button>
                    <button onClick={saveFields} disabled={savingFields} className="text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50">
                      {savingFields ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {editingFields ? (
                <div className="space-y-2">
                  {editFields.map((field: any, i: number) => (
                    <div key={i} className="p-2.5 bg-surface-50 dark:bg-night-800 rounded-xl border border-surface-100 dark:border-night-600">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-sm">{getFieldIcon(field.type)}</span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) => updateEditField(i, { label: e.target.value })}
                          className="flex-1 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                          placeholder="Field label"
                        />
                        <button onClick={() => removeEditField(i)} disabled={editFields.length <= 1} className="text-danger-400 hover:text-danger-600 text-xs disabled:opacity-30">✕</button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={field.type}
                          onChange={(e) => updateEditField(i, { type: e.target.value })}
                          className="px-1.5 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                        >
                          <option value="TEXT">Text</option>
                          <option value="TEXTAREA">Long Text</option>
                          <option value="NUMBER">Number</option>
                          <option value="EMAIL">Email</option>
                          <option value="DATE">Date</option>
                          <option value="SELECT">Dropdown</option>
                          <option value="RADIO">Radio</option>
                          <option value="CHECKBOX">Checkbox</option>
                          <option value="RATING">Rating</option>
                        </select>
                        <label className="flex items-center gap-0.5 text-xs">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(e) => updateEditField(i, { required: e.target.checked })}
                            className="rounded"
                          />
                          Req
                        </label>
                      </div>
                      {(field.type === 'SELECT' || field.type === 'RADIO' || field.type === 'CHECKBOX') && (
                        <input
                          type="text"
                          value={field.options?.join(', ') || ''}
                          onChange={(e) => updateEditField(i, { options: e.target.value.split(',').map((o: string) => o.trim()).filter(Boolean) })}
                          className="w-full mt-1.5 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-lg text-xs"
                          placeholder="Options (comma separated)"
                        />
                      )}
                    </div>
                  ))}
                  <button onClick={addEditField} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg">
                    <Plus size={12} /> Add Field
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {form.fields.map((field: any) => (
                    <div key={field.id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{getFieldIcon(field.type)}</span>
                        <span className="text-surface-600 dark:text-night-300">{field.label}</span>
                        {field.required && <span className="text-danger-500 text-xs">*</span>}
                      </div>
                      <span className="text-xs text-surface-400 dark:text-night-400">{field.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {isTeacher && form.expiresAt && (
            <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3 flex items-center gap-2">
                <Clock size={16} /> Extend Expiry
              </h3>
              <div className="flex gap-2">
                <select
                  value={extendDays}
                  onChange={(e) => setExtendDays(e.target.value)}
                  className="flex-1 px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm"
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                </select>
                <button
                  onClick={handleExtend}
                  className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 flex items-center gap-1"
                >
                  <Plus size={14} /> Extend
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

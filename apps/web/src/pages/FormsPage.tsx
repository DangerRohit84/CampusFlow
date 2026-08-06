import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { formAPI, departmentAPI, roomAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, FileText, Users, Trash2, Loader2, ChevronRight, Pencil, Calendar,
  Filter, Clock, CheckCircle2
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type FilterTab = 'all' | 'active' | 'expired'

export default function FormsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [forms, setForms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('active')
  const [showCreate, setShowCreate] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [fields, setFields] = useState<any[]>([
    { label: '', type: 'TEXT', required: false, options: [] },
  ])
  const [allowEdit, setAllowEdit] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')

  // Eligibility state
  const [departments, setDepartments] = useState<any[]>([])
  const [targetDepartments, setTargetDepartments] = useState<string[]>([])
  const [targetYears, setTargetYears] = useState<number[]>([])
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false)
  const [showEligibilityPopup, setShowEligibilityPopup] = useState(false)
  const [eligibilityMode, setEligibilityMode] = useState<'rooms' | 'department'>('rooms')
  const [teacherRooms, setTeacherRooms] = useState<any[]>([])
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([])

  // Edit modal state
  const [showEdit, setShowEdit] = useState(false)
  const [editFormId, setEditFormId] = useState<string | null>(null)
  const [editFormTitle, setEditFormTitle] = useState('')
  const [editFormDesc, setEditFormDesc] = useState('')
  const [editAllowEdit, setEditAllowEdit] = useState(false)
  const [editExpiresAt, setEditExpiresAt] = useState('')

  const [crRoomIds, setCrRoomIds] = useState<string[]>([])

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const canCreate = isTeacher || crRoomIds.length > 0

  const toggleRoom = (id: string) => {
    setSelectedRoomIds(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  const getFormStatus = (f: any): 'active' | 'expiring' | 'expired' => {
    if (f.expiresAt) {
      const diff = new Date(f.expiresAt).getTime() - Date.now()
      if (diff <= 0) return 'expired'
      if (diff <= 3 * 24 * 60 * 60 * 1000) return 'expiring'
    }
    return 'active'
  }

  const tabCounts = useMemo(() => ({
    all: forms.length,
    active: forms.filter(f => getFormStatus(f) !== 'expired').length,
    expired: forms.filter(f => getFormStatus(f) === 'expired').length,
  }), [forms])

  const filteredForms = useMemo(() => {
    if (activeTab === 'all') return forms
    if (activeTab === 'active') return forms.filter(f => getFormStatus(f) !== 'expired')
    return forms.filter(f => getFormStatus(f) === activeTab)
  }, [forms, activeTab])

  useEffect(() => {
    loadForms()
    departmentAPI.getAll().then(setDepartments).catch(() => {})
    if (isTeacher) {
      roomAPI.getAll().then(setTeacherRooms).catch(() => {})
    }
    if (user?.role === 'STUDENT') {
      roomAPI.getAll().then((rooms: any[]) => {
        const crRooms = rooms.filter((r: any) =>
          r.members?.some((m: any) => m.studentId === user.id && m.isCR)
        )
        setCrRoomIds(crRooms.map((r: any) => r.id))
        setTeacherRooms(crRooms)
      }).catch(() => {})
    }
  }, [user])

  const loadForms = async () => {
    try {
      const data = await formAPI.getAll()
      setForms(data)
    } catch (err) {
      console.error('Failed to load forms', err)
    } finally {
      setLoading(false)
    }
  }

  const addField = () => {
    setFields([...fields, { label: '', type: 'TEXT', required: false, options: [] }])
  }

  const updateField = (index: number, updates: any) => {
    const updated = [...fields]
    updated[index] = { ...updated[index], ...updates }
    setFields(updated)
  }

  const removeField = (index: number) => {
    if (fields.length === 1) return
    setFields(fields.filter((_, i) => i !== index))
  }

  const handleCreate = async () => {
    if (!formTitle || fields.every((f) => !f.label)) {
      toast.error('Title and at least one field required')
      return
    }
    setShowCreate(false)
    setShowEligibilityPopup(true)
  }

  const handleConfirmCreate = async (withEligibility: boolean) => {
    try {
      const payload: any = {
        title: formTitle,
        description: formDesc,
        allowEdit,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        fields: fields.filter((f) => f.label),
      }

      if (eligibilityMode === 'rooms' && selectedRoomIds.length > 0) {
        payload.roomIds = selectedRoomIds
      } else if (eligibilityMode === 'department' && withEligibility) {
        payload.targetDepartments = targetDepartments
        payload.targetYears = targetYears
        payload.eligibilityEnabled = targetDepartments.length > 0 || targetYears.length > 0
      }

      await formAPI.create(payload)
      toast.success('Form created!')
      setShowEligibilityPopup(false)
      setFormTitle('')
      setFormDesc('')
      setAllowEdit(false)
      setExpiresAt('')
      setFields([{ label: '', type: 'TEXT', required: false, options: [] }])
      setTargetDepartments([])
      setTargetYears([])
      setSelectedRoomIds([])
      setEligibilityMode('rooms')
      loadForms()
    } catch (err) {
      toast.error('Failed to create form')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this form?')) return
    try {
      await formAPI.delete(id)
      toast.success('Deleted')
      loadForms()
    } catch (err) {
      toast.error('Failed to delete')
    }
  }

  const openEditModal = (form: any) => {
    setEditFormId(form.id)
    setEditFormTitle(form.title)
    setEditFormDesc(form.description || '')
    setEditAllowEdit(form.allowEdit || false)
    setEditExpiresAt(form.expiresAt ? new Date(form.expiresAt).toISOString().slice(0, 16) : '')
    setShowEdit(true)
  }

  const handleEdit = async () => {
    if (!editFormId) return
    try {
      await formAPI.update(editFormId, {
        title: editFormTitle,
        description: editFormDesc,
        allowEdit: editAllowEdit,
        expiresAt: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
      })
      toast.success('Form updated!')
      setShowEdit(false)
      loadForms()
    } catch (err) {
      toast.error('Failed to update form')
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
      default: return '📝'
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
          <h1 className="text-2xl font-bold text-surface-900">Forms</h1>
          <p className="text-surface-500 text-sm mt-1">Create and manage custom forms</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
          >
            <Plus size={16} /> Create Form
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: 'all', label: 'All', icon: Filter },
          { key: 'active', label: 'Active', icon: CheckCircle2 },
          { key: 'expired', label: 'Expired', icon: Clock },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={clsx(
              'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              activeTab === key
                ? 'bg-primary-500 text-white shadow-md'
                : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
            )}
          >
            <Icon size={14} />
            {label}
            <span className={clsx(
              'ml-1 px-1.5 py-0.5 rounded-full text-xs',
              activeTab === key ? 'bg-white/20' : 'bg-surface-200'
            )}>
              {tabCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Forms Grid */}
      {forms.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-16 h-16 text-surface-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-surface-700">No forms yet</h3>
          <p className="text-surface-400 mt-1">
            {isTeacher ? 'Create your first form to get started' : 'No forms available yet'}
          </p>
        </div>
      ) : filteredForms.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-500">No {activeTab} forms</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredForms.map((f) => {
            const isExpired = f.expiresAt && new Date(f.expiresAt) < new Date()

            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={clsx(
                  'bg-white rounded-2xl border p-5 hover:shadow-lg transition-all cursor-pointer group',
                  getFormStatus(f) === 'expiring' ? 'border-red-200 bg-red-50/30' : 'border-surface-100'
                )}
                onClick={() => navigate(`/forms/${f.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  {isExpired ? (
                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-surface-100 text-surface-500">Expired</span>
                  ) : getFormStatus(f) === 'expiring' ? (
                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Expiring Soon</span>
                  ) : (
                    <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">{f.status || 'Active'}</span>
                  )}
                  <div className="flex gap-1">
                    {isTeacher && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(f) }}
                        className="p-1 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {f.creatorId === user?.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(f.id) }}
                        className="p-1 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="font-bold text-surface-900 mb-1 line-clamp-1">{f.title}</h3>
                {f.creator?.name && <p className="text-surface-500 text-xs mb-2">by {f.creator.name}</p>}

                <div className="flex items-center gap-3 text-xs text-surface-500">
                  <span className="flex items-center gap-1">
                    <FileText size={11} className="text-primary-500" />
                    {f.fields?.length || 0} fields
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={11} className="text-accent-500" />
                    {f.responses?.length || 0}
                  </span>
                  {f.expiresAt && (
                    <span className="flex items-center gap-1">
                      <Calendar size={11} className={clsx(getFormStatus(f) === 'expiring' ? 'text-red-400' : 'text-surface-400')} />
                      <span className={clsx(getFormStatus(f) === 'expiring' ? 'text-red-500 font-medium' : '')}>
                        {new Date(f.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                  )}
                </div>

                <div className="mt-3 pt-3 border-t border-surface-100 flex items-center justify-between">
                  <span className="text-xs text-surface-400">
                    {f.expiresAt ? `Due ${new Date(f.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'No deadline'}
                  </span>
                  <ChevronRight size={14} className="text-surface-400 group-hover:text-primary-500 transition-colors" />
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Create Form</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="Form title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
                    placeholder="What is this form for?"
                  />
                </div>

                {/* Allow Edit Toggle */}
                <div className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-surface-700">Allow editing responses</p>
                    <p className="text-xs text-surface-400">Students can change their submission after submitting</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowEdit(!allowEdit)}
                    className={clsx('relative w-11 h-6 rounded-full transition-colors', allowEdit ? 'bg-primary-500' : 'bg-surface-300')}
                  >
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', allowEdit && 'translate-x-5')} />
                  </button>
                </div>

                {/* Expiration */}
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Expiration (optional)</label>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                  />
                  <p className="text-xs text-surface-400 mt-1">Leave empty for no expiration</p>
                </div>

                {/* Fields */}
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-2 block">Fields</label>
                  <div className="space-y-3">
                    {fields.map((field, i) => (
                      <div key={i} className="p-3 bg-surface-50 rounded-xl border border-surface-100">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{getFieldIcon(field.type)}</span>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(i, { label: e.target.value })}
                            className="flex-1 px-2 py-1 bg-white border border-surface-200 rounded-lg text-sm"
                            placeholder="Field label"
                          />
                          <select
                            value={field.type}
                            onChange={(e) => updateField(i, { type: e.target.value })}
                            className="px-2 py-1 bg-white border border-surface-200 rounded-lg text-sm"
                          >
                            <option value="TEXT">Text</option>
                            <option value="TEXTAREA">Long Text</option>
                            <option value="NUMBER">Number</option>
                            <option value="EMAIL">Email</option>
                            <option value="DATE">Date</option>
                            <option value="SELECT">Dropdown</option>
                            <option value="RADIO">Radio</option>
                            <option value="CHECKBOX">Checkbox</option>
                          </select>
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(e) => updateField(i, { required: e.target.checked })}
                              className="rounded"
                            />
                            Req
                          </label>
                          {fields.length > 1 && (
                            <button
                              onClick={() => removeField(i)}
                              className="text-red-400 hover:text-red-600 text-xs"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {(field.type === 'SELECT' || field.type === 'RADIO' || field.type === 'CHECKBOX') && (
                          <input
                            type="text"
                            value={field.options?.join(', ') || ''}
                            onChange={(e) => updateField(i, { options: e.target.value.split(',').map((o) => o.trim()) })}
                            className="w-full px-2 py-1 bg-white border border-surface-200 rounded-lg text-xs"
                            placeholder="Options (comma separated)"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addField}
                    className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 rounded-lg"
                  >
                    <Plus size={12} /> Add Field
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowCreate(false)} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium">
                  Cancel
                </button>
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium">
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEdit && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowEdit(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 mb-4">Edit Form</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Title</label>
                  <input
                    type="text"
                    value={editFormTitle}
                    onChange={(e) => setEditFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                    placeholder="Form title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
                  <textarea
                    value={editFormDesc}
                    onChange={(e) => setEditFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
                    placeholder="What is this form for?"
                  />
                </div>

                {/* Allow Edit Toggle */}
                <div className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-surface-700">Allow editing responses</p>
                    <p className="text-xs text-surface-400">Students can change their submission after submitting</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditAllowEdit(!editAllowEdit)}
                    className={clsx('relative w-11 h-6 rounded-full transition-colors', editAllowEdit ? 'bg-primary-500' : 'bg-surface-300')}
                  >
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform', editAllowEdit && 'translate-x-5')} />
                  </button>
                </div>

                {/* Expiration */}
                <div>
                  <label className="text-sm font-medium text-surface-700 mb-1 block">Expiration (optional)</label>
                  <input
                    type="datetime-local"
                    value={editExpiresAt}
                    onChange={(e) => setEditExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
                  />
                  <p className="text-xs text-surface-400 mt-1">Leave empty for no expiration</p>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowEdit(false)} className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium">
                  Cancel
                </button>
                <button onClick={handleEdit} className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium">
                  Update
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Eligibility Popup */}
      <AnimatePresence>
        {showEligibilityPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
            onClick={() => { setShowEligibilityPopup(false); setShowCreate(true); setTargetDepartments([]); setTargetYears([]) }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
            >
              <h2 className="text-lg font-bold text-surface-900 mb-1">Who can respond?</h2>
              <p className="text-sm text-surface-500 mb-5">Select rooms or departments, or skip to allow everyone.</p>

              {/* Two mode buttons */}
              <div className="flex gap-3 mb-4">
                <button
                  onClick={() => setEligibilityMode('rooms')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    eligibilityMode === 'rooms'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-surface-200 hover:border-surface-300 text-surface-600'
                  }`}
                >
                  <div className="text-center">
                    <span className="text-2xl block mb-1">🏠</span>
                    <p className="font-semibold text-sm">Rooms</p>
                    <p className="text-xs text-surface-400">Select specific rooms</p>
                  </div>
                </button>
                <button
                  onClick={() => setEligibilityMode('department')}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all ${
                    eligibilityMode === 'department'
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-surface-200 hover:border-surface-300 text-surface-600'
                  }`}
                >
                  <div className="text-center">
                    <span className="text-2xl block mb-1">🏫</span>
                    <p className="font-semibold text-sm">Department</p>
                    <p className="text-xs text-surface-400">Select dept + year</p>
                  </div>
                </button>
              </div>

              {/* Rooms selection */}
              {eligibilityMode === 'rooms' && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {teacherRooms.length === 0 ? (
                    <p className="text-sm text-surface-400 text-center py-4">No rooms yet. Create a room first.</p>
                  ) : (
                    teacherRooms.map(room => (
                      <label key={room.id} className="flex items-center gap-3 p-2.5 rounded-xl border hover:bg-surface-50 cursor-pointer transition-all">
                        <input
                          type="checkbox"
                          checked={selectedRoomIds.includes(room.id)}
                          onChange={() => toggleRoom(room.id)}
                          className="w-4 h-4 rounded text-primary-500 focus:ring-primary-500"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-surface-800">{room.name}</p>
                          <p className="text-xs text-surface-400">{room._count?.members || 0} members</p>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              )}

              {/* Department selection */}
              {eligibilityMode === 'department' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-surface-600 mb-2 block">Departments</label>
                    <div className="flex flex-wrap gap-1.5">
                      {departments.map(d => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setTargetDepartments(prev =>
                            prev.includes(d.id) ? prev.filter(id => id !== d.id) : [...prev, d.id]
                          )}
                          className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                            targetDepartments.includes(d.id)
                              ? 'bg-primary-100 border-primary-300 text-primary-700'
                              : 'bg-white border-surface-200 text-surface-600 hover:border-primary-200'
                          )}
                        >
                          {d.name}
                        </button>
                      ))}
                      {departments.length === 0 && (
                        <p className="text-xs text-surface-400">No departments created yet.</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-surface-600 mb-2 block">Years</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4].map(y => (
                        <button
                          key={y}
                          type="button"
                          onClick={() => setTargetYears(prev =>
                            prev.includes(y) ? prev.filter(n => n !== y) : [...prev, y]
                          )}
                          className={clsx('w-12 h-9 rounded-lg text-sm font-bold border transition-all',
                            targetYears.includes(y)
                              ? 'bg-primary-100 border-primary-300 text-primary-700'
                              : 'bg-white border-surface-200 text-surface-600 hover:border-primary-200'
                          )}
                        >
                          {y}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(targetDepartments.length > 0 || targetYears.length > 0) && (
                    <div className="flex items-center gap-2 p-2.5 bg-primary-50 rounded-xl text-xs text-primary-700 font-medium">
                      <CheckCircle2 size={14} />
                      {targetDepartments.length > 0 && <span>{targetDepartments.length} dept{targetDepartments.length > 1 ? 's' : ''}</span>}
                      {targetDepartments.length > 0 && targetYears.length > 0 && <span>·</span>}
                      {targetYears.length > 0 && <span>Year {targetYears.sort().join(', ')}</span>}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => handleConfirmCreate(false)}
                  className="flex-1 px-4 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 text-sm"
                >
                  Skip — Everyone
                </button>
                <button
                  onClick={() => handleConfirmCreate(true)}
                  className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg text-sm"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

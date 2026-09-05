import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { formAPI, departmentAPI, roomAPI } from '../lib/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, FileText, Users, Trash2, Loader2, ChevronRight, Pencil, Calendar,
  Filter, Clock, CheckCircle2, FileEdit, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
import EligibilityPopup from '../components/shared/EligibilityPopup'
import { useFilteredItems } from '../hooks/useFilteredItems'
import { useModal } from '../hooks/useModal'
import type { Department, Room } from '../types/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'

type FormStatus = 'active' | 'expiring' | 'expired'

export default function FormsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [fields, setFields] = useState<any[]>([
    { id: '', formId: '', label: '', type: 'SHORT_ANSWER', required: false, order: 0 },
  ] as any)
  const [allowEdit, setAllowEdit] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')

  // Eligibility state
  const [departments, setDepartments] = useState<Department[]>([])
  const [targetDepartments, setTargetDepartments] = useState<string[]>([])
  const [targetYears, setTargetYears] = useState<number[]>([])
  const [eligibilityEnabled, setEligibilityEnabled] = useState(false)
  const [eligibilityMode, setEligibilityMode] = useState<'rooms' | 'department'>('rooms')
  const [teacherRooms, setTeacherRooms] = useState<Room[]>([])
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([])

  // Edit modal state
  const [editFormId, setEditFormId] = useState<string | null>(null)
  const [editFormTitle, setEditFormTitle] = useState('')
  const [editFormDesc, setEditFormDesc] = useState('')
  const [editAllowEdit, setEditAllowEdit] = useState(false)
  const [editExpiresAt, setEditExpiresAt] = useState('')

  const [crRoomIds, setCrRoomIds] = useState<string[]>([])

  const createModal = useModal()
  const editModal = useModal()
  const eligibilityPopup = useModal()

  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const canCreate = isTeacher || crRoomIds.length > 0

  const toggleRoom = (id: string) => {
    setSelectedRoomIds(prev =>
      prev.includes(id) ? prev.filter(r => r !== id) : [...prev, id]
    )
  }

  const getFormStatus = (f: any): FormStatus => {
    const expiryField = f.expiresAt || f.deadline
    if (expiryField) {
      const diff = new Date(expiryField).getTime() - Date.now()
      if (diff <= 0) return 'expired'
      if (diff <= 3 * 24 * 60 * 60 * 1000) return 'expiring'
    }
    return 'active'
  }

  const { data: formsData, isLoading: loading } = useQuery({
    queryKey: ['forms'],
    queryFn: ({ signal }) => formAPI.getAll({ signal } as any),
    staleTime: 3 * 60 * 1000,
  })
  const forms = (formsData as any[]) ?? []

  const { activeTab, setActiveTab, filteredItems: filteredForms } = useFilteredItems<any>({
    items: forms,
    tabs: [
      { key: 'all', label: 'All' },
      { key: 'active', label: 'Active' },
      { key: 'draft', label: 'Draft' },
      { key: 'closed', label: 'Closed' },
    ],
    defaultTab: 'active',
    filterFn: (f, tab) => {
      if (tab === 'all') return true
      if (tab === 'active') return getFormStatus(f) === 'active' || getFormStatus(f) === 'expiring'
      if (tab === 'draft') return !f.status || f.status === 'draft'
      if (tab === 'closed') return getFormStatus(f) === 'expired'
      return true
    },
  })

  const tabCounts = useMemo(() => ({
    all: forms.length,
    active: forms.filter(f => getFormStatus(f) === 'active' || getFormStatus(f) === 'expiring').length,
    draft: forms.filter(f => !f.status || f.status === 'draft').length,
    closed: forms.filter(f => getFormStatus(f) === 'expired').length,
  }), [forms])

  useEffect(() => {
    departmentAPI.getAll().then(setDepartments).catch(() => {})
    if (isTeacher) {
      roomAPI.getAll().then(setTeacherRooms).catch(() => {})
    }
    if (user?.role === 'STUDENT') {
      roomAPI.getAll().then((rooms: any[]) => {
        const crRooms = (rooms as any[]).filter((r: any) => r.isCR === true)
        setCrRoomIds(crRooms.map((r: any) => r.id))
        setTeacherRooms(crRooms)
      }).catch(() => {})
    }
  }, [user, isTeacher])

  const loadForms = async () => {
    await queryClient.invalidateQueries({ queryKey: ['forms'] })
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
    createModal.close()
    setEligibilityMode('rooms')
    eligibilityPopup.open()
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
      eligibilityPopup.close()
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
    editModal.open()
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
      editModal.close()
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
      case 'RADIO': return '⚪'
      case 'CHECKBOX': return '☑️'
      case 'NUMBER': return '🔢'
      case 'EMAIL': return '📧'
      case 'DATE': return '📅'
      default: return "📝";
    }
  }

  const getStatusBadge = (f: any) => {
    const status = getFormStatus(f)
    if (status === 'expired') return <Badge variant="default" dot>Closed</Badge>
    if (status === 'expiring') return <Badge variant="danger" dot>Expiring Soon</Badge>
    if (!f.status || f.status === 'draft') return <Badge variant="warning" dot>Draft</Badge>
    return <Badge variant="success" dot>Active</Badge>
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6 section--forms max-w-[1280px] mx-auto">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<ClipboardList size={18} />}
        eyebrow="Campus · Forms"
        title={<>Forms</>}
        subtitle="Collect responses — forms, deadlines and real-time insights."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header — neutral gray for forms (rose reserved for errors only, one wash per section) */}
      <PageHeader
        accent="neutral"
        title="Forms"
        subtitle="Create and manage custom forms — gray #F8F9FA slips · slate #1E293B (rose only expired)"
        icon={<FileText size={18} />}
        action={
          canCreate && (
            <button
              onClick={createModal.open}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 dark:bg-white text-white dark:text-slate-900 rounded-xl hover:bg-slate-700 dark:hover:bg-slate-100 transition-all text-sm font-medium shadow-sm"
            >
              <Plus size={16} /> Create Form
            </button>
          )
        }
      />

      {/* Filter Tabs — neutral for forms */}
      <FilterTabs
        accent="neutral"
        tabs={[
          { key: 'all', label: 'All', icon: Filter, count: tabCounts.all },
          { key: 'active', label: 'Active', icon: CheckCircle2, count: tabCounts.active },
          { key: 'draft', label: 'Draft', icon: FileEdit, count: tabCounts.draft },
          { key: 'closed', label: 'Closed', icon: Clock, count: tabCounts.closed },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key)}
      />

      {/* Forms List */}
      {forms.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No forms yet"
          description={isTeacher ? 'Create your first form to get started' : 'No forms available yet'}
        />
      ) : filteredForms.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={`No ${activeTab} forms`}
        />
      ) : (
        <div className="space-y-2">
          {filteredForms.map((f, index) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03, duration: 0.2 }}
            >
              <div
                onClick={() => navigate(`/forms/${f.id}`)}
                className={clsx('due-slip p-4 flex items-center gap-4 cursor-pointer hover:shadow-e2 transition-shadow group', getFormStatus(f)==='expiring' ? 'due-slip--urgent' : 'due-slip--neutral')}
              >
                <div className="w-10 h-10 rounded-xl bg-surface-50 border border-surface-200 dark:bg-zinc-900 dark:border-zinc-700 flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-slate-700 dark:text-zinc-400" />
                </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-bold text-surface-900 dark:text-night-50 truncate">{f.title}</h3>
                      {getStatusBadge(f)}
                    </div>
                    {f.description && (
                      <p className="text-sm text-surface-500 dark:text-night-400 truncate">{f.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-surface-400 dark:text-night-400">
                      {f.expiresAt && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          Due {formatDate(f.expiresAt)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {f.responses?.length || 0} responses
                      </span>
                      {f.creator?.name && (
                        <span className="text-surface-400 dark:text-night-400">by {f.creator.name}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {isTeacher && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(f) }}
                        className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-primary-500 dark:hover:text-sky-300 hover:bg-primary-50 dark:hover:bg-sky-950/30 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {f.creatorId === user?.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(f.id) }}
                        className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>

                  <ChevronRight size={18} className="text-surface-300 group-hover:text-primary-600 transition-colors shrink-0" />
                </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {createModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={createModal.close}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Create Form</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Title *</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    placeholder="Form title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
                  <textarea
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    placeholder="What is this form for?"
                  />
                </div>

                {/* Allow Edit Toggle */}
                <div className="flex items-center justify-between p-3 bg-surface-50 dark:bg-night-850 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-surface-700 dark:text-night-200">Allow editing responses</p>
                    <p className="text-xs text-surface-400 dark:text-night-200/70">Students can change their submission after submitting</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAllowEdit(!allowEdit)}
                    className={clsx('relative w-11 h-6 rounded-full transition-colors', allowEdit ? 'bg-primary-500' : 'bg-surface-300 dark:bg-night-600')}
                  >
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white dark:bg-night-50 rounded-full shadow transition-transform', allowEdit && 'translate-x-5')} />
                  </button>
                </div>

                {/* Expiration */}
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Expiration (optional)</label>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                  />
                  <p className="text-xs text-surface-400 dark:text-night-200/70 mt-1">Leave empty for no expiration</p>
                </div>

                {/* Fields */}
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-2 block">Fields</label>
                  <div className="space-y-3">
                    {fields.map((field, i) => (
                      <div key={i} className="p-3 bg-surface-50 dark:bg-night-850 rounded-xl border border-surface-100 dark:border-night-600">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{getFieldIcon(field.type)}</span>
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) => updateField(i, { label: e.target.value })}
                            className="flex-1 px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            placeholder="Field label"
                          />
                          <select
                            value={field.type}
                            onChange={(e) => updateField(i, { type: e.target.value })}
                            className="px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
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
                              className="text-danger-400 hover:text-danger-600 text-xs"
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
                            className="w-full px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            placeholder="Options (comma separated)"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addField}
                    className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-sky-300 hover:bg-primary-50 dark:hover:bg-sky-950/30 rounded-lg"
                  >
                    <Plus size={12} /> Add Field
                  </button>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={createModal.close} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-700 transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreate} className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors shadow-sm">
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editModal.isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={editModal.close}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-surface-900 dark:text-night-50 mb-4">Edit Form</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Title</label>
                  <input
                    type="text"
                    value={editFormTitle}
                    onChange={(e) => setEditFormTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    placeholder="Form title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
                  <textarea
                    value={editFormDesc}
                    onChange={(e) => setEditFormDesc(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    placeholder="What is this form for?"
                  />
                </div>

                {/* Allow Edit Toggle */}
                <div className="flex items-center justify-between p-3 bg-surface-50 dark:bg-night-850 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-surface-700 dark:text-night-200">Allow editing responses</p>
                    <p className="text-xs text-surface-400 dark:text-night-200/70">Students can change their submission after submitting</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditAllowEdit(!editAllowEdit)}
                    className={clsx('relative w-11 h-6 rounded-full transition-colors', editAllowEdit ? 'bg-primary-500' : 'bg-surface-300 dark:bg-night-600')}
                  >
                    <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white dark:bg-night-50 rounded-full shadow transition-transform', editAllowEdit && 'translate-x-5')} />
                  </button>
                </div>

                {/* Expiration */}
                <div>
                  <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Expiration (optional)</label>
                  <input
                    type="datetime-local"
                    value={editExpiresAt}
                    onChange={(e) => setEditExpiresAt(e.target.value)}
                    className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                  />
                  <p className="text-xs text-surface-400 dark:text-night-200/70 mt-1">Leave empty for no expiration</p>
                </div>
              </div>

              <div className="flex gap-3 mt-5">
                <button onClick={editModal.close} className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-700 transition-colors">
                  Cancel
                </button>
                <button onClick={handleEdit} className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 transition-colors shadow-sm">
                  Update
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Eligibility Popup */}
      <EligibilityPopup
        show={eligibilityPopup.isOpen}
        title="Who can respond?"
        subtitle={isTeacher ? 'Select rooms or departments, or skip to allow everyone.' : 'Select rooms where you are CR, or skip to allow everyone.'}
        departments={departments}
        targetDepartments={targetDepartments}
        setTargetDepartments={setTargetDepartments}
        targetYears={targetYears}
        setTargetYears={setTargetYears}
        showDepartmentMode={isTeacher}
        showRoomsMode={true}
        eligibilityMode={eligibilityMode}
        setEligibilityMode={setEligibilityMode}
        rooms={teacherRooms}
        selectedRoomIds={selectedRoomIds}
        toggleRoom={toggleRoom}
        onSkip={() => handleConfirmCreate(false)}
        onConfirm={() => handleConfirmCreate(true)}
        onCancel={() => { eligibilityPopup.close(); createModal.open(); setTargetDepartments([]); setTargetYears([]) }}
      />
    </div>
  )
}

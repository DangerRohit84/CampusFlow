import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { formAPI, roomAPI } from '../lib/api'
import { useDepartments } from '../hooks/useDepartments'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { notifyEntityMutated } from '../lib/entitySync'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, FileText, Users, Trash2, ChevronRight, Pencil, Calendar,
  Filter, Clock, CheckCircle2, FileEdit } from 'lucide-react'
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
import CenteredLoader from '../components/ui/CenteredLoader'
import { useConfirm } from '../components/ui/ConfirmModal'

type FormStatus = 'active' | 'expiring' | 'expired'

// #9 logic-lite builder helpers: per-question rules + per-option points.
// New questions have no server ids yet, so branching references use stable
// client keys (`tmp-<index>`); the backend rewrites them to real ids on
// create (see forms.ts rewriteLogicClientRefs).
const CHOICE_TYPES = ['SELECT', 'RADIO', 'CHECKBOX']
const JUMP_END = '__END__'

function newBuilderField(): any {
  return {
    label: '', type: 'TEXT', required: false, options: [],
    optionPoints: {}, showIfField: '', showIfValue: '',
    hideIfField: '', hideIfValue: '', requireIfField: '', requireIfValue: '',
    jumpRules: [],
  }
}

function builderFieldToPayload(f: any, index: number): any {
  const options: string[] = Array.isArray(f.options)
    ? f.options.map((o: any) => String(o ?? '').trim()).filter(Boolean)
    : String(f.options ?? '').split(',').map((o: string) => o.trim()).filter(Boolean)
  const scoreMap: Record<string, number> = {}
  const pts = (f.optionPoints && typeof f.optionPoints === 'object' ? f.optionPoints : {}) as Record<string, unknown>
  for (const opt of options) {
    const n = Number((pts as any)[opt])
    if (Number.isFinite(n) && n !== 0) scoreMap[opt] = Math.max(-10000, Math.min(10000, n))
  }
  const logic: any = {}
  if (f.showIfField && f.showIfValue?.trim()) logic.showIf = [{ field: f.showIfField, equals: f.showIfValue.trim() }]
  if (f.hideIfField && f.hideIfValue?.trim()) logic.hideIf = [{ field: f.hideIfField, equals: f.hideIfValue.trim() }]
  if (f.requireIfField && f.requireIfValue?.trim()) logic.requireIf = [{ field: f.requireIfField, equals: f.requireIfValue.trim() }]
  const jumps = Array.isArray(f.jumpRules) ? f.jumpRules.filter((r: any) => r?.equals?.trim() && r?.to) : []
  if (jumps.length > 0) logic.jumpTo = jumps.map((r: any) => ({ equals: r.equals.trim(), to: r.to }))
  return {
    label: String(f.label ?? '').trim(),
    type: f.type || 'TEXT',
    required: !!f.required,
    options,
    ...(Object.keys(scoreMap).length > 0 ? { scoreMap } : {}),
    ...((logic.showIf || logic.hideIf || logic.requireIf || logic.jumpTo) ? { logic } : {}),
    clientId: `tmp-${index}`,
  }
}

function fieldShortLabel(f: any, index: number): string {
  const label = String(f?.label ?? '').trim()
  return label ? `Q${index + 1} · ${label.slice(0, 24)}` : `Q${index + 1} (untitled)`
}

export default function FormsPage() {
  const { confirm: confirmDialog } = useConfirm()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [fields, setFields] = useState<any[]>([newBuilderField()] as any)
  const [allowEdit, setAllowEdit] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  // #9: which builder cards show their Logic panel.
  const [expandedLogic, setExpandedLogic] = useState<Record<number, boolean>>({})

  // Eligibility state — departments served from the shared 10-min RQ key
  // (PERPAGE-HALF2: was an uncached departmentAPI.getAll() per mount; same
  // array data via useDepartments, zero cross-page dedupe before).
  const { data: departmentsData } = useDepartments()
  const departments: Department[] = (departmentsData as Department[]) ?? []
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

  // STATE-SYNC: reactive college scope — college switches change the key.
  const overrideScope = useCollegeScope()
  const { data: formsData, isLoading: loading } = useQuery({
    queryKey: qk.forms((user as any)?.collegeId || overrideScope),
    queryFn: ({ signal }) => formAPI.getAll({ signal } as any),
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
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
    // Departments now come from useDepartments() above (shared cache).
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
    notifyEntityMutated('form')
  }

  const addField = () => {
    setFields([...fields, newBuilderField()])
  }

  const updateField = (index: number, updates: any) => {
    const updated = [...fields]
    const next = { ...updated[index], ...updates }
    // Prune points for removed options so payloads never carry stale keys.
    if (updates.options !== undefined && next.optionPoints) {
      const keep = new Set(
        (Array.isArray(updates.options) ? updates.options : []).map((o: any) => String(o ?? '').trim()).filter(Boolean),
      )
      const pruned: Record<string, number> = {}
      for (const [k, v] of Object.entries(next.optionPoints as Record<string, unknown>)) {
        if (keep.has(k)) pruned[k] = v as number
      }
      next.optionPoints = pruned
    }
    updated[index] = next
    setFields(updated)
  }

  const updateOptionPoints = (index: number, option: string, points: string) => {
    const updated = [...fields]
    const prev = { ...((updated[index] as any).optionPoints || {}) }
    const n = points === '' || points === null ? NaN : Number(points)
    if (points === '' || !Number.isFinite(n)) delete prev[option]
    else prev[option] = Math.max(-10000, Math.min(10000, n))
    updated[index] = { ...updated[index], optionPoints: prev }
    setFields(updated)
  }

  const toggleLogic = (index: number) => {
    setExpandedLogic((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  const updateJumpRule = (index: number, ruleIdx: number, patch: any) => {
    const updated = [...fields]
    const rules = [...(((updated[index] as any).jumpRules || []) as any[])]
    rules[ruleIdx] = { ...rules[ruleIdx], ...patch }
    updated[index] = { ...updated[index], jumpRules: rules }
    setFields(updated)
  }

  const addJumpRule = (index: number) => {
    const updated = [...fields]
    const rules = [...(((updated[index] as any).jumpRules || []) as any[])]
    if (rules.length >= 10) return
    rules.push({ equals: '', to: '' })
    updated[index] = { ...updated[index], jumpRules: rules }
    setFields(updated)
  }

  const removeJumpRule = (index: number, ruleIdx: number) => {
    const updated = [...fields]
    updated[index] = {
      ...updated[index],
      jumpRules: (((updated[index] as any).jumpRules || []) as any[]).filter((_: any, i: number) => i !== ruleIdx),
    }
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
      const validFields = fields
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => String(f?.label ?? '').trim())
      if (validFields.length === 0) {
        toast.error('Title and at least one field required')
        return
      }
      const payload: any = {
        title: formTitle,
        description: formDesc,
        allowEdit,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        fields: validFields.map(({ f, i }) => builderFieldToPayload(f, i)),
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
      setFields([newBuilderField()])
      setExpandedLogic({})
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
    const ok = await confirmDialog({ title: 'Delete form?', message: 'Delete this form and its responses?', confirmLabel: 'Delete' })
    if (!ok) return
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
    return <CenteredLoader text="Loading forms..." />
  }

  return (
    <div className="space-y-6 section--forms max-w-[1280px] mx-auto">
      <h1 className="sr-only">Forms — Create and manage campus forms</h1>
      {/* Header — forms */}
      <PageHeader
        accent="neutral"
        title="Forms"
        subtitle="Create and manage custom forms"
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
                role="link"
                tabIndex={0}
                aria-label={`Open form ${f.title}`}
                onClick={() => navigate(`/forms/${f.id}`)}
                onKeyDown={(e) => {
                  // WHY: div cards must be keyboard-operable (WCAG 2.1.1) — Enter/Space mirrors click.
                  if (e.key === 'Enter' || e.key === ' ') {
                    // Don't hijack Space when focus is on an inner button (edit/delete).
                    const t = e.target as HTMLElement
                    if (t.closest('button')) return
                    e.preventDefault()
                    navigate(`/forms/${f.id}`)
                  }
                }}
                className={clsx('due-slip p-4 flex items-center gap-4 cursor-pointer hover:shadow-e2 transition-shadow group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2', getFormStatus(f)==='expiring' ? 'due-slip--urgent' : 'due-slip--neutral')}
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
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    {isTeacher && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(f) }}
                        aria-label={`Edit form ${f.title}`}
                        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-primary-500 dark:hover:text-sky-300 hover:bg-primary-50 dark:hover:bg-sky-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    )}
                    {f.creatorId === user?.id && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(f.id) }}
                        aria-label={`Delete form ${f.title}`}
                        className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <ChevronRight size={18} aria-hidden="true" className="text-surface-300 group-hover:text-primary-600 transition-colors shrink-0" />
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
                          <span className="text-lg" aria-hidden="true">{getFieldIcon(field.type)}</span>
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
                          <>
                            <input
                              type="text"
                              value={field.options?.join(', ') || ''}
                              onChange={(e) => updateField(i, { options: e.target.value.split(',').map((o) => o.trim()) })}
                              className="w-full px-2 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                              placeholder="Options (comma separated)"
                            />
                            {/* #9 scoring: per-option points */}
                            {(field.options || []).filter(Boolean).length > 0 && (
                              <div className="mt-1.5 space-y-1">
                                <p className="text-[11px] font-semibold text-surface-500 dark:text-night-400">Points per option (quiz scoring, 0 = no points)</p>
                                {(field.options || []).filter(Boolean).map((opt: string) => (
                                  <div key={opt} className="flex items-center gap-2">
                                    <span className="flex-1 truncate text-xs text-surface-600 dark:text-night-300">{opt}</span>
                                    <input
                                      type="number"
                                      value={(field.optionPoints?.[opt] ?? '') as any}
                                      onChange={(e) => updateOptionPoints(i, opt, e.target.value)}
                                      className="w-20 px-2 py-0.5 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs"
                                      placeholder="0"
                                      min={-10000}
                                      max={10000}
                                      step={1}
                                      aria-label={`Points for option ${opt}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                        {/* #9 logic: show/hide/require/jump by answer (lite: equals) */}
                        <button
                          type="button"
                          onClick={() => toggleLogic(i)}
                          aria-expanded={!!expandedLogic[i]}
                          className="mt-2 text-[11px] font-semibold text-primary-600 dark:text-sky-300 hover:underline"
                        >
                          {expandedLogic[i] ? 'Hide logic ▴' : 'Add logic (show / hide / require / jump) ▾'}
                        </button>
                        {expandedLogic[i] && (
                          <div className="mt-1.5 space-y-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800 p-2">
                            {[
                              { key: 'showIf', title: 'Show this question only if', fieldKey: 'showIfField', valueKey: 'showIfValue' },
                              { key: 'hideIf', title: 'Hide this question if', fieldKey: 'hideIfField', valueKey: 'hideIfValue' },
                              { key: 'requireIf', title: 'Require this question if', fieldKey: 'requireIfField', valueKey: 'requireIfValue' },
                            ].map((row: any) => (
                              <div key={row.key} className="space-y-1">
                                <p className="text-[11px] font-semibold text-surface-500 dark:text-night-400">{row.title}</p>
                                <div className="flex items-center gap-1.5">
                                  <select
                                    value={(field as any)[row.fieldKey] || ''}
                                    onChange={(e) => updateField(i, { [row.fieldKey]: e.target.value })}
                                    className="flex-1 px-1.5 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs"
                                    aria-label={`${row.title} source question`}
                                  >
                                    <option value="">Never</option>
                                    {fields.slice(0, i).map((prev: any, pi: number) => (
                                      <option key={pi} value={`tmp-${pi}`}>{fieldShortLabel(prev, pi)}</option>
                                    ))}
                                  </select>
                                  <span className="text-[11px] text-surface-400">is</span>
                                  <input
                                    type="text"
                                    value={(field as any)[row.valueKey] || ''}
                                    onChange={(e) => updateField(i, { [row.valueKey]: e.target.value })}
                                    disabled={!(field as any)[row.fieldKey]}
                                    className="flex-1 px-1.5 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs disabled:opacity-40"
                                    placeholder="answer value"
                                    aria-label={`${row.title} value`}
                                  />
                                </div>
                              </div>
                            ))}
                            <div className="space-y-1">
                              <p className="text-[11px] font-semibold text-surface-500 dark:text-night-400">Jump to question based on this answer</p>
                              {(((field as any).jumpRules || []) as any[]).map((rule: any, ri: number) => (
                                <div key={ri} className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-surface-400">If =</span>
                                  <input
                                    type="text"
                                    value={rule.equals || ''}
                                    onChange={(e) => updateJumpRule(i, ri, { equals: e.target.value })}
                                    className="flex-1 px-1.5 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs"
                                    placeholder="answer value"
                                    aria-label={`Jump rule ${ri + 1} value`}
                                  />
                                  <span className="text-[11px] text-surface-400">→</span>
                                  <select
                                    value={rule.to || ''}
                                    onChange={(e) => updateJumpRule(i, ri, { to: e.target.value })}
                                    className="flex-1 px-1.5 py-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 text-surface-900 dark:text-night-50 rounded-lg text-xs"
                                    aria-label={`Jump rule ${ri + 1} target`}
                                  >
                                    <option value="">Select…</option>
                                    {fields.slice(i + 1).map((next: any, ni: number) => (
                                      <option key={ni} value={`tmp-${i + 1 + ni}`}>{fieldShortLabel(next, i + 1 + ni)}</option>
                                    ))}
                                    <option value={JUMP_END}>End form</option>
                                  </select>
                                  <button type="button" onClick={() => removeJumpRule(i, ri)} className="text-danger-400 hover:text-danger-600 text-xs" aria-label={`Remove jump rule ${ri + 1}`}>✕</button>
                                </div>
                              ))}
                              <button type="button" onClick={() => addJumpRule(i)} className="text-[11px] font-semibold text-primary-600 dark:text-sky-300 hover:underline">
                                + Add jump rule
                              </button>
                              <p className="text-[10px] text-surface-400 dark:text-night-400">Skipped questions are hidden from validation & scoring.</p>
                            </div>
                          </div>
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

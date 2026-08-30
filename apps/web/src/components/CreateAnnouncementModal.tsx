import { useState, useEffect } from 'react'
import Modal from './ui/Modal'
import { departmentAPI, announcementsAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'

interface AnnouncementData {
  id: string
  title: string
  content: string
  target: string
  targetScope?: string
  publishAt?: string | null
  expiresAt?: string | null
  departments?: { department: { id: string; name: string } }[]
  colleges?: { college: { id: string; name: string } }[]
}

interface CreateAnnouncementModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
  announcement?: AnnouncementData | null
}

export default function CreateAnnouncementModal({ open, onClose, onCreated, announcement }: CreateAnnouncementModalProps) {
  const { user } = useAuthStore()
  const isEdit = !!announcement
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [target, setTarget] = useState<'ALL_DEPARTMENTS' | 'SPECIFIC_DEPARTMENTS'>('ALL_DEPARTMENTS')
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([])
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)

  // Schedule & Expiry
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [publishAt, setPublishAt] = useState('')
  const [expiryEnabled, setExpiryEnabled] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')

  // Super admin college targeting
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const [targetScope, setTargetScope] = useState<'ALL_COLLEGES' | 'SPECIFIC_COLLEGES' | 'MY_COLLEGES'>('MY_COLLEGES')
  const [colleges, setColleges] = useState<{ id: string; name: string }[]>([])
  const [selectedCollegeIds, setSelectedCollegeIds] = useState<string[]>([])
  const [loadingColleges, setLoadingColleges] = useState(false)

  // Pre-fill form when editing
  useEffect(() => {
    if (open && announcement) {
      setTitle(announcement.title)
      setContent(announcement.content)
      setTarget(announcement.target as 'ALL_DEPARTMENTS' | 'SPECIFIC_DEPARTMENTS')
      setSelectedDeptIds(announcement.departments?.map((d) => d.department.id) || [])
      if (announcement.targetScope && isSuperAdmin) {
        setTargetScope(announcement.targetScope as any)
        setSelectedCollegeIds(announcement.colleges?.map((c) => c.college.id) || [])
      }
      if (announcement.publishAt) {
        setScheduleEnabled(true)
        setPublishAt(new Date(announcement.publishAt).toISOString().slice(0, 16))
      }
      if (announcement.expiresAt) {
        setExpiryEnabled(true)
        setExpiresAt(new Date(announcement.expiresAt).toISOString().slice(0, 16))
      }
    } else if (open && !announcement) {
      reset()
    }
  }, [open, announcement])

  useEffect(() => {
    if (open && user?.collegeId) {
      departmentAPI.getAll(user.collegeId).then(setDepartments).catch(() => {})
    }
    if (open && isSuperAdmin) {
      setLoadingColleges(true)
      announcementsAPI.listColleges().then(setColleges).catch(() => {}).finally(() => setLoadingColleges(false))
    }
  }, [open, user?.collegeId, isSuperAdmin])

  const reset = () => {
    setTitle('')
    setContent('')
    setTarget('ALL_DEPARTMENTS')
    setSelectedDeptIds([])
    setTargetScope('MY_COLLEGES')
    setSelectedCollegeIds([])
    setScheduleEnabled(false)
    setPublishAt('')
    setExpiryEnabled(false)
    setExpiresAt('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required')
      return
    }
    if (target === 'SPECIFIC_DEPARTMENTS' && selectedDeptIds.length === 0) {
      toast.error('Select at least one department')
      return
    }
    if (isSuperAdmin && targetScope === 'SPECIFIC_COLLEGES' && selectedCollegeIds.length === 0) {
      toast.error('Select at least one college')
      return
    }
    if (scheduleEnabled && publishAt && expiryEnabled && expiresAt && new Date(expiresAt) <= new Date(publishAt)) {
      toast.error('Expiry must be after scheduled publish time')
      return
    }

    setLoading(true)
    try {
      const payload = {
        title: title.trim(),
        content: content.trim(),
        target,
        ...(target === 'SPECIFIC_DEPARTMENTS' ? { departmentIds: selectedDeptIds } : {}),
        ...(isSuperAdmin ? { targetScope, ...(targetScope === 'SPECIFIC_COLLEGES' ? { collegeIds: selectedCollegeIds } : {}) } : {}),
        ...(scheduleEnabled && publishAt ? { publishAt: new Date(publishAt).toISOString() } : {}),
        ...(expiryEnabled && expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }

      if (isEdit) {
        await announcementsAPI.update(announcement!.id, payload)
        toast.success('Announcement updated!')
      } else {
        await announcementsAPI.create(payload as any)
        toast.success(scheduleEnabled ? 'Announcement scheduled!' : 'Announcement posted!')
      }
      reset()
      onCreated()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || (isEdit ? 'Failed to update announcement' : 'Failed to create announcement'))
    } finally {
      setLoading(false)
    }
  }

  const toggleDept = (id: string) => {
    setSelectedDeptIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )
  }

  const toggleCollege = (id: string) => {
    setSelectedCollegeIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  const selectAllColleges = () => {
    setSelectedCollegeIds(colleges.map((c) => c.id))
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Announcement' : 'Create Announcement'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="block text-sm font-semibold text-surface-700 dark:text-night-100 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Announcement title"
            className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-surface-400 dark:text-night-400 mt-1">{title.length}/200</p>
        </div>

        {/* Content */}
        <div>
          <label className="block text-sm font-semibold text-surface-700 dark:text-night-100 mb-1">Content</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Write your announcement here..."
            className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
        </div>

        {/* Target Audience */}
        <div>
          <label className="block text-sm font-semibold text-surface-700 dark:text-night-100 mb-2">Target Audience</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setTarget('ALL_DEPARTMENTS')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                target === 'ALL_DEPARTMENTS'
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-600'
                  : 'border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700'
              }`}
            >
              All Departments
            </button>
            <button
              type="button"
              onClick={() => setTarget('SPECIFIC_DEPARTMENTS')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                target === 'SPECIFIC_DEPARTMENTS'
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-600'
                  : 'border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700'
              }`}
            >
              Specific Departments
            </button>
          </div>
        </div>

        {/* Department checkboxes */}
        {target === 'SPECIFIC_DEPARTMENTS' && (
          <div className="border border-surface-200 dark:border-night-600 rounded-lg p-3 max-h-48 overflow-y-auto">
            {departments.length === 0 ? (
              <p className="text-sm text-surface-400 dark:text-night-400 text-center py-2">No departments found</p>
            ) : (
              <div className="space-y-1.5">
                {departments.map((dept) => (
                  <label key={dept.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-md hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedDeptIds.includes(dept.id)}
                      onChange={() => toggleDept(dept.id)}
                      className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-surface-700 dark:text-night-200">{dept.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Super Admin: College Scope */}
        {isSuperAdmin && (
          <div>
            <label className="block text-sm font-semibold text-surface-700 dark:text-night-100 mb-2">College Scope</label>
            <div className="flex gap-2">
              {([
                { value: 'ALL_COLLEGES' as const, label: 'All Colleges', active: 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-600' },
                { value: 'SPECIFIC_COLLEGES' as const, label: 'Specific Colleges', active: 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-600' },
                { value: 'MY_COLLEGES' as const, label: 'My College', active: 'border-purple-500 bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-600' },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setTargetScope(opt.value); setSelectedCollegeIds([]) }}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    targetScope === opt.value
                      ? opt.active
                      : 'border-surface-200 dark:border-night-600 text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-night-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Super Admin: College checkboxes */}
        {isSuperAdmin && targetScope === 'SPECIFIC_COLLEGES' && (
          <div className="border border-surface-200 dark:border-night-600 rounded-lg p-3 max-h-48 overflow-y-auto">
            {loadingColleges ? (
              <p className="text-sm text-surface-400 dark:text-night-400 text-center py-2">Loading colleges...</p>
            ) : colleges.length === 0 ? (
              <p className="text-sm text-surface-400 dark:text-night-400 text-center py-2">No colleges found</p>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={selectAllColleges}
                    className="text-xs font-semibold text-primary-600 hover:text-primary-700"
                  >
                    Select All
                  </button>
                  {selectedCollegeIds.length > 0 && (
                    <span className="text-xs text-surface-400 dark:text-night-400">{selectedCollegeIds.length} selected</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {colleges.map((college) => (
                    <label key={college.id} className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-md hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedCollegeIds.includes(college.id)}
                        onChange={() => toggleCollege(college.id)}
                        className="w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm text-surface-700 dark:text-night-200">{college.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Schedule for later */}
        <div className="border border-surface-200 dark:border-night-600 rounded-lg p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-surface-700 dark:text-night-100">Schedule for later</span>
              <span className="text-xs text-surface-400 dark:text-night-400">(optional)</span>
            </div>
            <button
              type="button"
              onClick={() => { setScheduleEnabled(!scheduleEnabled); if (scheduleEnabled) setPublishAt('') }}
              className={`relative w-10 h-5 rounded-full transition-colors ${scheduleEnabled ? 'bg-primary-500' : 'bg-surface-300 dark:bg-night-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${scheduleEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          {scheduleEnabled && (
            <div>
              <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Publish at</label>
              <input
                type="datetime-local"
                value={publishAt}
                onChange={(e) => setPublishAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}
        </div>

        {/* Auto-expire */}
        <div className="border border-surface-200 dark:border-night-600 rounded-lg p-4 space-y-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-surface-700 dark:text-night-100">Auto-expire</span>
              <span className="text-xs text-surface-400 dark:text-night-400">(optional)</span>
            </div>
            <button
              type="button"
              onClick={() => { setExpiryEnabled(!expiryEnabled); if (expiryEnabled) setExpiresAt('') }}
              className={`relative w-10 h-5 rounded-full transition-colors ${expiryEnabled ? 'bg-primary-500' : 'bg-surface-300 dark:bg-night-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${expiryEnabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          {expiryEnabled && (
            <div>
              <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Expires at</label>
              <input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-surface-600 dark:text-night-300 hover:bg-surface-100 dark:hover:bg-night-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
          >
            {loading ? (isEdit ? 'Saving...' : 'Posting...') : (isEdit ? 'Save Changes' : 'Post Announcement')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

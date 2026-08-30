import { useState } from 'react'
import {
  ChevronDown, ChevronRight, Download, File, FileArchive, FileSpreadsheet,
  FileText, Folder, Image as ImageIcon, Loader2, MessageSquare, Presentation,
  Trash2, Upload,
} from 'lucide-react'
import Badge from '../ui/Badge'

const CATEGORIES = [
  { key: 'lecture', label: 'Lectures', icon: Folder },
  { key: 'assignment', label: 'Assignments', icon: FileSpreadsheet },
  { key: 'reference', label: 'Reference', icon: FileText },
  { key: 'other', label: 'Other', icon: File },
]

const FILE_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function formatFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Absolute-URL guard: cloud storage returns absolute URLs, local uploads are root-relative
function resolveFileUrl(url: string) {
  return url.startsWith('http') ? url : `${FILE_API_BASE}/${url}`
}

function ResourceFileIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return <FileText size={16} className="text-danger-500 shrink-0" />
  if (ext === 'ppt' || ext === 'pptx') return <Presentation size={16} className="text-warning-500 shrink-0" />
  if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheet size={16} className="text-primary-500 shrink-0" />
  if (ext === 'doc' || ext === 'docx') return <FileText size={16} className="text-primary-500 shrink-0" />
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext || '')) return <ImageIcon size={16} className="text-primary-500 shrink-0" />
  if (ext === 'zip' || ext === 'rar') return <FileArchive size={16} className="text-accent-500 shrink-0" />
  return <File size={16} className="text-surface-400 dark:text-night-300 shrink-0" />
}

interface RoomResourcesPanelProps {
  grouped: Record<string, any[]>
  loading: boolean
  canManage: boolean
  deletingId: string | null
  onUploadClick: () => void
  onDelete: (resourceId: string) => void
}

export default function RoomResourcesPanel({
  grouped, loading, canManage, deletingId, onUploadClick, onDelete,
}: RoomResourcesPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    lecture: true,
    assignment: true,
    reference: true,
    other: true,
  })

  const total = Object.values(grouped).flat().length

  const toggleCategory = (cat: string) => setExpanded((prev) => ({ ...prev, [cat]: !prev[cat] }))

  const downloadResource = (resource: any) => {
    const url = resolveFileUrl(resource.fileUrl)
    const a = document.createElement('a')
    a.href = url
    a.download = resource.title || resource.filename || 'download'
    a.click()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-surface-900 dark:text-night-50">Resources</h2>
        {canManage && (
          <button
            onClick={onUploadClick}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
          >
            <Upload size={14} /> Upload
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-night-600" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-surface-100 dark:bg-night-600 rounded-lg w-1/3" />
                  <div className="h-2.5 bg-surface-100 dark:bg-night-600 rounded-lg w-1/4" />
                </div>
                <div className="w-6 h-6 rounded-lg bg-surface-100 dark:bg-night-600" />
              </div>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-night-700 flex items-center justify-center mx-auto mb-3">
            <FileText size={22} className="text-surface-400 dark:text-night-300" />
          </div>
          <p className="font-semibold text-surface-700 dark:text-night-100 text-sm">No resources yet</p>
          <p className="text-surface-400 dark:text-night-300 text-xs mt-1">
            {canManage
              ? 'Upload lectures, assignments and reference material for the room'
              : 'Files shared by your teacher will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {CATEGORIES.map(({ key, label, icon: Icon }) => {
            const items = grouped[key] || []
            if (items.length === 0) return null

            return (
              <div key={key} className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 overflow-hidden">
                <button
                  onClick={() => toggleCategory(key)}
                  className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Icon size={16} className="text-surface-500 dark:text-night-200" />
                    <span className="font-semibold text-surface-900 dark:text-night-50 text-sm">{label}</span>
                    <Badge variant="default">{items.length}</Badge>
                  </div>
                  {expanded[key]
                    ? <ChevronDown size={16} className="text-surface-400 dark:text-night-300" />
                    : <ChevronRight size={16} className="text-surface-400 dark:text-night-300" />}
                </button>

                {expanded[key] && (
                  <div className="border-t border-surface-100 dark:border-night-600">
                    {items.map((resource: any) => {
                      const sharedInChat = typeof resource.description === 'string' && resource.description.startsWith('Shared in chat')
                      const meta = [
                        formatFileSize(resource.fileSize),
                        new Date(resource.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
                        resource.uploader?.name ? `by ${resource.uploader.name}` : '',
                      ].filter(Boolean).join(' · ')
                      return (
                        <div
                          key={resource.id}
                          className="flex items-center gap-3 px-5 py-3 border-b border-surface-50 dark:border-night-700 last:border-b-0 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors group"
                        >
                          <ResourceFileIcon filename={resource.filename || resource.title} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-surface-900 dark:text-night-50 text-sm truncate">{resource.title}</p>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              <p className="text-xs text-surface-400 dark:text-night-300 truncate">{meta}</p>
                              {sharedInChat && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-50 dark:bg-accent-500/10 text-accent-600 dark:text-accent-300 text-[10px] font-semibold shrink-0">
                                  <MessageSquare size={9} />
                                  Shared in chat
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => downloadResource(resource)}
                              className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                            {canManage && (
                              <button
                                onClick={() => onDelete(resource.id)}
                                disabled={deletingId === resource.id}
                                className="p-1.5 rounded-lg text-surface-400 dark:text-night-300 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors disabled:opacity-50"
                                title="Delete"
                              >
                                {deletingId === resource.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

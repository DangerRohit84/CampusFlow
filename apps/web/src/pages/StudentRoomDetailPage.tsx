import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Users, FileText, Loader2, Download,
  BookOpen, Folder,
  File, FileImage, FileSpreadsheet, ChevronDown, ChevronRight,
  LogOut, User
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'

const CATEGORIES = [
  { key: 'lecture', label: 'Lectures', icon: BookOpen },
  { key: 'assignment', label: 'Assignments', icon: FileSpreadsheet },
  { key: 'reference', label: 'Reference', icon: Folder },
  { key: 'other', label: 'Other', icon: File },
]

const FILE_API_BASE = 'http://localhost:4000'

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['pdf'].includes(ext || '')) return <FileText size={16} className="text-red-500" />
  if (['pptx', 'ppt'].includes(ext || '')) return <FileImage size={16} className="text-orange-500" />
  if (['xlsx', 'xls', 'csv'].includes(ext || '')) return <FileSpreadsheet size={16} className="text-green-500" />
  if (['doc', 'docx'].includes(ext || '')) return <FileText size={16} className="text-blue-500" />
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext || '')) return <FileImage size={16} className="text-purple-500" />
  return <File size={16} className="text-surface-400" />
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function StudentRoomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [room, setRoom] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'members' | 'resources'>('resources')
  const [members, setMembers] = useState<any[]>([])
  const [resources, setResources] = useState<Record<string, any[]>>({})
  const [showLeave, setShowLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    lecture: true,
    assignment: true,
    reference: true,
    other: true,
  })

  useEffect(() => {
    if (id) loadRoom()
  }, [id])

  useEffect(() => {
    if (id && activeTab === 'members') loadMembers()
    if (id && activeTab === 'resources') loadResources()
  }, [id, activeTab])

  const loadRoom = async () => {
    try {
      const data = await roomAPI.getOne(id!)
      setRoom(data)
    } catch (err) {
      toast.error('Failed to load room')
      navigate('/rooms')
    } finally {
      setLoading(false)
    }
  }

  const loadMembers = async () => {
    try {
      const data = await roomAPI.getMembers(id!)
      setMembers(data)
    } catch (err) {
      console.error('Failed to load members', err)
    }
  }

  const loadResources = async () => {
    try {
      const data = await roomAPI.getResources(id!)
      // Backend returns grouped: { lecture: [...], assignment: [...], ... }
      const grouped: Record<string, any[]> = { lecture: [], assignment: [], reference: [], other: [] }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Already grouped from backend
        Object.entries(data).forEach(([cat, items]) => {
          if (grouped[cat]) grouped[cat] = items as any[]
          else grouped.other.push(...(items as any[]))
        })
      } else if (Array.isArray(data)) {
        // Flat array fallback
        data.forEach((r: any) => {
          const cat = r.category || 'other'
          if (grouped[cat]) grouped[cat].push(r)
          else grouped.other.push(r)
        })
      }
      setResources(grouped)
    } catch (err) {
      console.error('Failed to load resources', err)
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await roomAPI.leave(id!)
      toast.success('Left room successfully')
      setShowLeave(false)
      navigate('/rooms')
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to leave room'
      toast.error(message)
    } finally {
      setLeaving(false)
    }
  }

  const downloadResource = (resource: any) => {
    const url = `${FILE_API_BASE}/${resource.fileUrl}`
    const a = document.createElement('a')
    a.href = url
    a.download = resource.title || resource.filename || 'download'
    a.click()
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const totalResources = Object.values(resources).flat().length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  if (!room) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/rooms')}
          className="p-2 rounded-xl bg-surface-100 hover:bg-surface-200 transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
              <BookOpen size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900">{room.name}</h1>
              {room.description && (
                <p className="text-surface-500 text-sm mt-0.5">{room.description}</p>
              )}
            </div>
          </div>
        </div>
        {/* Leave Room Button */}
        <button
          onClick={() => setShowLeave(true)}
          className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-200 text-sm font-medium hover:bg-red-100 transition-all"
        >
          <LogOut size={14} /> Leave Room
        </button>
      </div>

      {/* Room Info Bar */}
      <div className="flex items-center gap-4 flex-wrap">
        {room.teacher && (
          <div className="flex items-center gap-1 text-xs text-surface-500">
            <User size={12} className="text-primary-500" />
            <span>Teacher: <span className="font-medium text-surface-700">{room.teacher.name}</span></span>
          </div>
        )}
        <span className="text-xs text-surface-400">
          {members.length} members · {totalResources} resources
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 pb-2">
        <button
          onClick={() => setActiveTab('resources')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'resources'
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
          )}
        >
          <FileText size={14} />
          Resources
          <span className={clsx(
            'ml-1 px-1.5 py-0.5 rounded-full text-xs',
            activeTab === 'resources' ? 'bg-white/20' : 'bg-surface-200'
          )}>
            {totalResources}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
            activeTab === 'members'
              ? 'bg-primary-500 text-white shadow-md'
              : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
          )}
        >
          <Users size={14} />
          Members
          <span className={clsx(
            'ml-1 px-1.5 py-0.5 rounded-full text-xs',
            activeTab === 'members' ? 'bg-white/20' : 'bg-surface-200'
          )}>
            {members.length}
          </span>
        </button>
      </div>

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <div className="space-y-4">
          <h2 className="font-bold text-surface-900">Resources</h2>

          {totalResources === 0 ? (
            <div className="bg-white rounded-2xl border border-surface-100 p-10 text-center">
              <FileText className="w-12 h-12 text-surface-300 mx-auto mb-3" />
              <p className="text-surface-500 text-sm">No resources uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {CATEGORIES.map(({ key, label, icon: Icon }) => {
                const items = resources[key] || []
                if (items.length === 0) return null

                return (
                  <div key={key} className="bg-white rounded-2xl border border-surface-100 overflow-hidden">
                    <button
                      onClick={() => toggleCategory(key)}
                      className="w-full flex items-center justify-between px-5 py-3 hover:bg-surface-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={16} className="text-surface-500" />
                        <span className="font-semibold text-surface-900 text-sm">{label}</span>
                        <Badge variant="default">{items.length}</Badge>
                      </div>
                      {expandedCategories[key] ? <ChevronDown size={16} className="text-surface-400" /> : <ChevronRight size={16} className="text-surface-400" />}
                    </button>

                    {expandedCategories[key] && (
                      <div className="border-t border-surface-100">
                        {items.map((resource: any) => (
                          <div
                            key={resource.id}
                            className="flex items-center gap-3 px-5 py-3 border-b border-surface-50 last:border-b-0 hover:bg-surface-50 transition-colors group"
                          >
                            {getFileIcon(resource.filename || resource.title)}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-surface-900 text-sm truncate">{resource.title}</p>
                              <p className="text-xs text-surface-400">
                                {formatFileSize(resource.fileSize || 0)} · {new Date(resource.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              </p>
                            </div>
                            <button
                              onClick={() => downloadResource(resource)}
                              className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors opacity-0 group-hover:opacity-100"
                              title="Download"
                            >
                              <Download size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <h2 className="font-bold text-surface-900 mb-4">Members ({members.length})</h2>
          {members.length === 0 ? (
            <div className="text-center py-10">
              <Users className="w-12 h-12 text-surface-300 mx-auto mb-3" />
              <p className="text-surface-500 text-sm">No members yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-100">
                    <th className="text-left py-2 text-surface-500 font-medium">Roll No</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Name</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Email</th>
                    <th className="text-left py-2 text-surface-500 font-medium">Department</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member: any) => (
                    <tr key={member.id} className="border-b border-surface-50">
                      <td className="py-2 font-mono text-xs text-surface-600">{member.studentId || '-'}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-surface-900">{member.name}</p>
                          {member.isCR && (
                            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700 rounded-full">
                              CR
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-xs text-surface-400">{member.email}</td>
                      <td className="py-2 text-xs text-surface-500">{member.department?.name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Leave Room Confirmation Modal */}
      <Modal open={showLeave} onClose={() => setShowLeave(false)} title="Leave Room" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-600">
            Are you sure you want to leave <span className="font-bold text-surface-900">{room.name}</span>?
            You will need a new join code to rejoin.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowLeave(false)}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {leaving && <Loader2 size={14} className="animate-spin" />}
              Leave Room
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

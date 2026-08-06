import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Users, FileText, Loader2, Upload, Download,
  Trash2, Copy, KeyRound, BookOpen, Folder,
  File, FileImage, FileSpreadsheet, ChevronDown, ChevronRight
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

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [room, setRoom] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'members' | 'resources'>('members')
  const [members, setMembers] = useState<any[]>([])
  const [resources, setResources] = useState<Record<string, any[]>>({})
  const [showUpload, setShowUpload] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('lecture')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
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
      // Group by category
      const grouped: Record<string, any[]> = { lecture: [], assignment: [], reference: [], other: [] }
      data.forEach((r: any) => {
        const cat = r.category || 'other'
        if (grouped[cat]) grouped[cat].push(r)
        else grouped.other.push(r)
      })
      setResources(grouped)
    } catch (err) {
      console.error('Failed to load resources', err)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('Please select a file')
      return
    }
    if (!uploadTitle.trim()) {
      toast.error('Please enter a title')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', uploadFile)
      formData.append('title', uploadTitle.trim())
      formData.append('category', uploadCategory)

      await roomAPI.uploadResource(id!, formData)
      toast.success('Resource uploaded!')
      setShowUpload(false)
      setUploadTitle('')
      setUploadCategory('lecture')
      setUploadFile(null)
      loadResources()
    } catch (err) {
      toast.error('Failed to upload resource')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteResource = async (resourceId: string) => {
    setDeleting(resourceId)
    try {
      await roomAPI.deleteResource(id!, resourceId)
      toast.success('Resource deleted!')
      loadResources()
    } catch (err) {
      toast.error('Failed to delete resource')
    } finally {
      setDeleting(null)
    }
  }

  const downloadResource = (resource: any) => {
    const url = `${FILE_API_BASE}/${resource.fileUrl}`
    const a = document.createElement('a')
    a.href = url
    a.download = resource.title || resource.filename || 'download'
    a.click()
  }

  const copyJoinCode = () => {
    if (room?.joinCode) {
      navigator.clipboard.writeText(room.joinCode)
      toast.success('Join code copied!')
    }
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  const handleToggleCR = async (studentId: string, isCurrentlyCR: boolean) => {
    try {
      if (isCurrentlyCR) {
        await roomAPI.removeCR(id!, studentId)
        toast.success('CR removed')
      } else {
        await roomAPI.makeCR(id!, studentId)
        toast.success('Student is now CR')
      }
      loadRoom()
    } catch (err) {
      toast.error('Failed to update CR status')
    }
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
        {/* Join Code */}
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-50 rounded-xl border border-surface-200">
          <KeyRound size={14} className="text-primary-500" />
          <span className="font-mono font-bold text-surface-900 tracking-wider">{room.joinCode}</span>
          <button
            onClick={copyJoinCode}
            className="p-1 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
            title="Copy join code"
          >
            <Copy size={14} />
          </button>
        </div>
      </div>

      {/* Room Info Bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="text-xs text-surface-400">
          {members.length} members · {totalResources} resources
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-100 pb-2">
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
      </div>

      {/* Members Tab */}
      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <h2 className="font-bold text-surface-900 mb-4">Members ({members.length})</h2>
          {members.length === 0 ? (
            <div className="text-center py-10">
              <Users className="w-12 h-12 text-surface-300 mx-auto mb-3" />
              <p className="text-surface-500 text-sm">No members yet. Share the join code.</p>
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
                    <th className="text-left py-2 text-surface-500 font-medium">CR</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member: any) => (
                    <tr key={member.id} className="border-b border-surface-50">
                      <td className="py-2 font-mono text-xs text-surface-600">{member.studentId || '-'}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
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
                      <td className="py-2">
                        <button
                          onClick={() => handleToggleCR(member.studentId, member.isCR)}
                          className={`text-xs font-semibold px-2 py-1 rounded-lg ${
                            member.isCR
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                          }`}
                        >
                          {member.isCR ? 'Remove CR' : 'Make CR'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-surface-900">Resources</h2>
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
            >
              <Upload size={14} /> Upload
            </button>
          </div>

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
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => downloadResource(resource)}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                                title="Download"
                              >
                                <Download size={14} />
                              </button>
                              <button
                                onClick={() => handleDeleteResource(resource.id)}
                                disabled={deleting === resource.id}
                                className="p-1.5 rounded-lg text-surface-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                                title="Delete"
                              >
                                {deleting === resource.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            </div>
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

      {/* Upload Modal */}
      <Modal open={showUpload} onClose={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }} title="Upload Resource" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Title *</label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
              placeholder="e.g., Lecture 1 - Introduction"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm bg-white"
            >
              {CATEGORIES.map(({ key, label }) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">File *</label>
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-100 file:text-primary-700 hover:file:bg-primary-200"
            />
            {uploadFile && (
              <p className="text-xs text-surface-400 mt-1">{uploadFile.name} ({formatFileSize(uploadFile.size)})</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

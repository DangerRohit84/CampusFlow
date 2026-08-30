import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { getSocket } from '../lib/socket'
import { Loader2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import RoomChatPanel from '../components/room/RoomChatPanel'
import RoomChatSettingsModal from '../components/room/RoomChatSettingsModal'
import RoomHeader from '../components/room/RoomHeader'
import RoomTabs, { type RoomTabKey } from '../components/room/RoomTabs'
import RoomResourcesPanel, { formatFileSize } from '../components/room/RoomResourcesPanel'
import RoomMembersPanel from '../components/room/RoomMembersPanel'

export default function RoomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [room, setRoom] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<RoomTabKey>('chat')
  const [members, setMembers] = useState<any[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [resources, setResources] = useState<Record<string, any[]>>({})
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [unreadChat, setUnreadChat] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('lecture')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  useEffect(() => {
    if (id) {
      loadRoom()
      // clear sidebar badge when opening room
      roomAPI.markRead(id).then(() => window.dispatchEvent(new CustomEvent('room:read', { detail: { roomId: id } }))).catch(() => {})
    }
  }, [id])

  useEffect(() => {
    if (id && activeTab === 'members') loadMembers()
    if (id && activeTab === 'resources') loadResources()
  }, [id, activeTab])

  // Chat badge dot: flag incoming messages that arrive while another tab is open
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !id) return
    const handler = (message: any) => {
      if (message.roomId !== id) return
      if (message.senderId === user?.id) return
      if (activeTabRef.current !== 'chat') setUnreadChat(true)
    }
    socket.on('room:message:new', handler)
    return () => { socket.off('room:message:new', handler) }
  }, [id, user?.id])

  const handleTabChange = (tab: RoomTabKey) => {
    setActiveTab(tab)
    if (tab === 'chat') {
      setUnreadChat(false)
      if (id) roomAPI.markRead(id).then(() => window.dispatchEvent(new CustomEvent('room:read', { detail: { roomId: id } }))).catch(() => {})
    }
  }

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
    setMembersLoading(true)
    try {
      const data = await roomAPI.getMembers(id!)
      setMembers(data)
    } catch (err) {
      console.error('Failed to load members', err)
    } finally {
      setMembersLoading(false)
    }
  }

  const loadResources = async () => {
    setResourcesLoading(true)
    try {
      const data = await roomAPI.getResources(id!)
      // Backend returns grouped: { lecture: [...], assignment: [...], ... }
      const grouped: Record<string, any[]> = { lecture: [], assignment: [], reference: [], other: [] }
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        Object.entries(data).forEach(([cat, items]) => {
          if (grouped[cat]) grouped[cat] = items as any[]
          else grouped.other.push(...(items as any[]))
        })
      } else if (Array.isArray(data)) {
        data.forEach((r: any) => {
          const cat = r.category || 'other'
          if (grouped[cat]) grouped[cat].push(r)
          else grouped.other.push(r)
        })
      }
      setResources(grouped)
    } catch (err) {
      console.error('Failed to load resources', err)
    } finally {
      setResourcesLoading(false)
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

  const handleToggleCR = async (studentId: string, isCurrentlyCR: boolean) => {
    try {
      if (isCurrentlyCR) {
        await roomAPI.removeCR(id!, studentId)
        toast.success('CR removed')
      } else {
        await roomAPI.makeCR(id!, studentId)
        toast.success('Student is now CR')
      }
      loadMembers()
    } catch (err) {
      toast.error('Failed to update CR status')
    }
  }

  const totalResources = Object.values(resources).flat().length

  // Derived from room state so optimistic settings updates reflect instantly
  const canManageSettings = !!room?.canManageSettings
  const effectiveCanChat = room
    ? canManageSettings ||
      room.chatMode === 'EVERYONE' ||
      (room.chatMode === 'SELECTED' && (room.allowedMembers || []).some((m: any) => m.id === user?.id))
    : false

  const openChatSettings = async () => {
    if (members.length === 0) await loadMembers()
    setShowChatSettings(true)
  }

  const applyChatSettings = (settings: { chatMode: string; allowedMembers: any[] }) => {
    setRoom((prev: any) => (prev ? { ...prev, chatMode: settings.chatMode, allowedMembers: settings.allowedMembers } : prev))
  }

  const revertChatSettings = () => {
    loadRoom()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  if (!room) return null

  return (
    <div className="space-y-6">
      <RoomHeader
        roomName={room.name}
        description={room.description}
        memberCount={members.length}
        resourceCount={totalResources}
        joinCode={room.joinCode}
        onBack={() => navigate('/rooms')}
      />

      <RoomTabs
        activeTab={activeTab}
        onChange={handleTabChange}
        resourceCount={totalResources}
        memberCount={members.length}
        unreadChat={unreadChat}
        showSettings={canManageSettings}
        onOpenSettings={openChatSettings}
      />

      {/* Chat Tab */}
      {activeTab === 'chat' && user && (
        <RoomChatPanel
          roomId={id!}
          canChat={effectiveCanChat}
          chatMode={room.chatMode || 'EVERYONE'}
          currentUserId={user.id}
          canDeleteForEveryone={
            room.teacherId === user.id ||
            user.role === 'SUPER_ADMIN' ||
            (user.role === 'COLLEGE_ADMIN' && !!user.collegeId && room.teacher?.collegeId === user.collegeId)
          }
        />
      )}

      {/* Members Tab */}
      {activeTab === 'members' && (
        <RoomMembersPanel
          members={members}
          teacher={room.teacher ? { id: room.teacher.id, name: room.teacher.name, email: room.teacher.email } : null}
          currentUserId={user?.id || ''}
          loading={membersLoading}
          canManageCR
          onToggleCR={handleToggleCR}
        />
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <RoomResourcesPanel
          grouped={resources}
          loading={resourcesLoading}
          canManage
          deletingId={deleting}
          onUploadClick={() => setShowUpload(true)}
          onDelete={handleDeleteResource}
        />
      )}

      {/* Upload Modal */}
      <Modal open={showUpload} onClose={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }} title="Upload Resource" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-100 mb-1 block">Title *</label>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., Lecture 1 - Introduction"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-100 mb-1 block">Category</label>
            <select
              value={uploadCategory}
              onChange={(e) => setUploadCategory(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm bg-white dark:bg-night-850 text-surface-900 dark:text-night-50"
            >
              <option value="lecture">Lectures</option>
              <option value="assignment">Assignments</option>
              <option value="reference">Reference</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-100 mb-1 block">File *</label>
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm dark:text-night-200 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-100 file:text-primary-700 hover:file:bg-primary-200"
            />
            {uploadFile && (
              <p className="text-xs text-surface-400 dark:text-night-300 mt-1">{uploadFile.name} ({formatFileSize(uploadFile.size)})</p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowUpload(false); setUploadTitle(''); setUploadCategory('lecture'); setUploadFile(null) }}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-100 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-500"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Upload
            </button>
          </div>
        </div>
      </Modal>

      {/* Chat Settings Modal */}
      <RoomChatSettingsModal
        open={showChatSettings}
        onClose={() => setShowChatSettings(false)}
        roomId={id!}
        chatMode={room.chatMode || 'EVERYONE'}
        allowedMembers={room.allowedMembers || []}
        members={members}
        onOptimisticSave={applyChatSettings}
        onSaveFailed={revertChatSettings}
      />
    </div>
  )
}
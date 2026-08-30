import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { getSocket } from '../lib/socket'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import RoomChatPanel from '../components/room/RoomChatPanel'
import RoomChatSettingsModal from '../components/room/RoomChatSettingsModal'
import RoomHeader from '../components/room/RoomHeader'
import RoomTabs, { type RoomTabKey } from '../components/room/RoomTabs'
import RoomResourcesPanel from '../components/room/RoomResourcesPanel'
import RoomMembersPanel from '../components/room/RoomMembersPanel'

export default function StudentRoomDetailPage() {
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
  const [showLeave, setShowLeave] = useState(false)
  const [showChatSettings, setShowChatSettings] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  useEffect(() => {
    if (id) {
      loadRoom()
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
    } finally {
      setResourcesLoading(false)
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
        teacherName={room.teacher?.name}
        onBack={() => navigate('/rooms')}
        onLeave={() => setShowLeave(true)}
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
        />
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <RoomResourcesPanel
          grouped={resources}
          loading={resourcesLoading}
          canManage={false}
          deletingId={null}
          onUploadClick={() => {}}
          onDelete={() => {}}
        />
      )}

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

      {/* Leave Room Confirmation Modal */}
      <Modal open={showLeave} onClose={() => setShowLeave(false)} title="Leave Room" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-600 dark:text-night-200">
            Are you sure you want to leave <span className="font-bold text-surface-900 dark:text-night-50">{room.name}</span>?
            You will need a new join code to rejoin.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowLeave(false)}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-600 text-surface-700 dark:text-night-100 rounded-xl font-medium hover:bg-surface-200 dark:hover:bg-night-500"
            >
              Cancel
            </button>
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="flex-1 px-4 py-2 bg-danger-500 text-white rounded-xl font-medium hover:bg-danger-600 disabled:opacity-50 flex items-center justify-center gap-2"
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
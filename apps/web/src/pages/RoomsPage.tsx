import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { getSocket } from '../lib/socket'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, BookOpen, Users, FileText, Copy, Share2,
  Trash2, Loader2, Pencil, ChevronRight, KeyRound,
  Building2, UsersRound, GraduationCap, Layers
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import FilterTabs from '../components/shared/FilterTabs'
import EmptyState from '../components/shared/EmptyState'
import PageHeader from '../components/shared/PageHeader'
import { useFilteredItems } from '../hooks/useFilteredItems'

type RoomType = 'department' | 'club' | 'study_group' | 'custom'

const typeConfig: Record<RoomType, { gradient: string; overlay: string; icon: any; label: string }> = {
  department: {
    gradient: 'from-primary-500 to-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: Building2,
    label: 'Department',
  },
  club: {
    gradient: 'from-primary-500 to-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: UsersRound,
    label: 'Club',
  },
  study_group: {
    gradient: 'from-primary-500 to-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: GraduationCap,
    label: 'Study Group',
  },
  custom: {
    gradient: 'from-warning-500 to-warning-500',
    overlay: 'from-warning-500/10 to-warning-500/5',
    icon: Layers,
    label: 'Custom',
  },
}

const getRoomType = (room: any): RoomType => {
  if (room.type) return room.type.toLowerCase().replace(' ', '_') as RoomType
  return 'custom'
}

export default function RoomsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editRoom, setEditRoom] = useState<any>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { activeTab, setActiveTab, filteredItems: filteredRooms } = useFilteredItems<any>({
    items: rooms,
    tabs: [
      { key: 'all', label: 'All' },
      { key: 'department', label: 'Department' },
      { key: 'club', label: 'Club' },
      { key: 'study_group', label: 'Study Group' },
      { key: 'custom', label: 'Custom' },
    ],
    defaultTab: 'all',
    filterFn: (room, tab) => {
      if (tab === 'all') return true
      return getRoomType(room) === tab
    },
  })

  const tabCounts = useMemo(() => ({
    all: rooms.length,
    department: rooms.filter(r => getRoomType(r) === 'department').length,
    club: rooms.filter(r => getRoomType(r) === 'club').length,
    study_group: rooms.filter(r => getRoomType(r) === 'study_group').length,
    custom: rooms.filter(r => getRoomType(r) === 'custom').length,
  }), [rooms])

  useEffect(() => {
    loadRooms()
  }, [])

  // Live unread updates + refresh on markRead
  useEffect(() => {
    const socketHandler = (message: any) => {
      setRooms((prev) => prev.map((r) => r.id === message.roomId ? { ...r, unreadCount: (Number(r.unreadCount) || 0) + 1 } : r))
      setTimeout(() => roomAPI.getAll().then(setRooms).catch(() => {}), 800)
    }
    const onRead = () => roomAPI.getAll().then(setRooms).catch(() => {})
    const s = getSocket()
    if (s) s.on('room:message:new', socketHandler)
    window.addEventListener('room:read', onRead)
    return () => {
      if (s) s.off('room:message:new', socketHandler)
      window.removeEventListener('room:read', onRead)
    }
  }, [])

  const loadRooms = async () => {
    try {
      const data = await roomAPI.getAll()
      setRooms(data)
    } catch (err) {
      console.error('Failed to load rooms', err)
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setName('')
    setDescription('')
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Room name is required')
      return
    }
    setSubmitting(true)
    try {
      await roomAPI.create({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      toast.success('Room created!')
      setShowCreate(false)
      resetForm()
      loadRooms()
    } catch (err) {
      toast.error('Failed to create room')
    } finally {
      setSubmitting(false)
    }
  }

  const openEditModal = (room: any) => {
    setEditRoom(room)
    setName(room.name)
    setDescription(room.description || '')
    setShowEdit(true)
  }

  const handleEdit = async () => {
    if (!name.trim()) {
      toast.error('Room name is required')
      return
    }
    setSubmitting(true)
    try {
      await roomAPI.update(editRoom.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      toast.success('Room updated!')
      setShowEdit(false)
      setEditRoom(null)
      resetForm()
      loadRooms()
    } catch (err) {
      toast.error('Failed to update room')
    } finally {
      setSubmitting(false)
    }
  }

  const openDeleteConfirm = (room: any) => {
    setDeleteTarget(room)
    setShowDelete(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await roomAPI.delete(deleteTarget.id)
      toast.success('Room deleted!')
      setShowDelete(false)
      setDeleteTarget(null)
      loadRooms()
    } catch (err) {
      toast.error('Failed to delete room')
    } finally {
      setSubmitting(false)
    }
  }

  const copyJoinCode = (code: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(code)
    toast.success('Join code copied!')
  }

  const shareJoinCode = (room: any, e: React.MouseEvent) => {
    e.stopPropagation()
    const link = `${window.location.origin}/rooms/join?code=${room.joinCode}`
    navigator.clipboard.writeText(link)
    toast.success('Join link copied!')
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
      <PageHeader
        title="Rooms"
        subtitle="Manage your classrooms, clubs, and study groups"
        action={
          <button
            onClick={() => { resetForm(); setShowCreate(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition-all text-sm font-medium shadow-sm"
          >
            <Plus size={16} /> Create Room
          </button>
        }
      />

      {/* Filter Tabs */}
      <FilterTabs
        tabs={[
          { key: 'all', label: 'All', icon: Layers, count: tabCounts.all },
          { key: 'department', label: 'Department', icon: Building2, count: tabCounts.department },
          { key: 'club', label: 'Club', icon: UsersRound, count: tabCounts.club },
          { key: 'study_group', label: 'Study Group', icon: GraduationCap, count: tabCounts.study_group },
          { key: 'custom', label: 'Custom', icon: BookOpen, count: tabCounts.custom },
        ]}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key)}
      />

      {/* Rooms Grid */}
      {rooms.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No rooms yet"
          description="Create your first room to start sharing resources with students"
        />
      ) : filteredRooms.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={`No ${activeTab.replace('_', ' ')} rooms`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRooms.map((room, index) => {
            const roomType = getRoomType(room)
            const config = typeConfig[roomType]
            const TypeIcon = config.icon

            return (
              <motion.div
                key={room.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05, duration: 0.25 }}
              >
                <Card
                  hover
                  padding="none"
                  onClick={() => navigate(`/rooms/${room.id}`)}
                  className="group overflow-hidden relative"
                >
                  {/* Gradient Header */}
                  <div className={clsx('relative bg-gradient-to-br p-6 pb-8', config.gradient)}>
                    {/* Subtle overlay pattern */}
                    <div className="absolute inset-0 bg-white/5" />
                    <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-white/10 rounded-full blur-xl" />

                    {/* Type Icon */}
                    <div className="relative w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <TypeIcon size={22} className="text-white" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="relative px-5 pt-4 pb-5 -mt-2">
                    {/* Type Badge */}
                    <Badge variant="default" className="mb-2">{config.label}</Badge>

                    {/* Room Name */}
                    <h3 className="font-bold text-surface-900 text-lg line-clamp-1 mb-1">{room.name}</h3>

                    {room.description && (
                      <p className="text-sm text-surface-500 line-clamp-2 mb-3">{room.description}</p>
                    )}

                    {/* Member Count + unread badge */}
                    <div className="flex items-center gap-2 text-sm text-surface-500">
                      <Users size={14} className="text-surface-400" />
                      <span>{room._count?.members ?? room.members?.length ?? 0} members</span>
                      {room.unreadCount > 0 && (
                        <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white rounded-full text-[11px] font-bold">
                          {room.unreadCount > 99 ? '99+' : room.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Join Code */}
                    <div className="mt-3 p-2.5 bg-surface-50 rounded-xl flex items-center gap-2">
                      <KeyRound size={13} className="text-primary-500 shrink-0" />
                      <span className="font-mono font-bold text-surface-800 text-xs tracking-wider">{room.joinCode}</span>
                      <div className="flex gap-1 ml-auto">
                        <button
                          onClick={(e) => copyJoinCode(room.joinCode, e)}
                          className="p-1 rounded-md text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                          title="Copy code"
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          onClick={(e) => shareJoinCode(room, e)}
                          className="p-1 rounded-md text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                          title="Copy join link"
                        >
                          <Share2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Actions Row */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-100">
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/rooms/${room.id}`) }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition-colors shadow-sm"
                      >
                        Open <ChevronRight size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditModal(room) }}
                        className="p-2 rounded-xl text-surface-400 hover:text-primary-500 hover:bg-primary-50 border border-surface-200 transition-all"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openDeleteConfirm(room) }}
                        className="p-2 rounded-xl text-surface-400 hover:text-danger-500 hover:bg-danger-50 border border-surface-200 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Room" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Create
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={showEdit} onClose={() => { setShowEdit(false); setEditRoom(null); resetForm() }} title="Edit Room" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowEdit(false); setEditRoom(null); resetForm() }}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEdit}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-primary-500 text-white rounded-xl font-medium hover:bg-primary-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Update
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={showDelete} onClose={() => { setShowDelete(false); setDeleteTarget(null) }} title="Delete Room" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-600">
            Are you sure you want to delete <span className="font-bold text-surface-900">{deleteTarget?.name}</span>?
            This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowDelete(false); setDeleteTarget(null) }}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-danger-500 text-white rounded-xl font-medium hover:bg-danger-600 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              Delete
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

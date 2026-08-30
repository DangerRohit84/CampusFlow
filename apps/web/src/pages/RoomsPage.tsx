import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { getSocket } from '../lib/socket'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, BookOpen, Users, FileText, Copy, Share2,
  Trash2, Loader2, Pencil, ChevronRight, KeyRound,
  Building2, UsersRound, GraduationCap, Layers, DoorOpen
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
    gradient: 'bg-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: Building2,
    label: 'Department',
  },
  club: {
    gradient: 'bg-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: UsersRound,
    label: 'Club',
  },
  study_group: {
    gradient: 'bg-primary-600',
    overlay: 'from-primary-500/10 to-primary-600/5',
    icon: GraduationCap,
    label: 'Study Group',
  },
  custom: {
    gradient: 'bg-warning-500',
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
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editRoom, setEditRoom] = useState<any>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: roomsData, isLoading: loading } = useQuery({
    queryKey: ['rooms'],
    queryFn: ({ signal }) => roomAPI.getAll({ signal } as any),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  })
  const rooms = (roomsData as any[]) ?? []

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

  // Live unread: increment local count instead of full refetch (avoids N+1 reload storm)
  useEffect(() => {
    const socketHandler = (message: any) => {
      queryClient.setQueryData(['rooms'], (old: any) => {
        if (!Array.isArray(old)) return old
        return old.map((r: any) => r.id === message.roomId ? { ...r, unreadCount: (Number(r.unreadCount) || 0) + 1 } : r)
      })
    }
    const onRead = (e: any) => {
      const roomId = e?.detail?.roomId
      if (roomId) {
        queryClient.setQueryData(['rooms'], (old: any) => {
          if (!Array.isArray(old)) return old
          return old.map((r: any) => r.id === roomId ? { ...r, unreadCount: 0 } : r)
        })
      } else {
        queryClient.invalidateQueries({ queryKey: ['rooms'] })
      }
    }
    const s = getSocket()
    if (s) s.on('room:message:new', socketHandler)
    window.addEventListener('room:read', onRead as any)
    return () => {
      if (s) s.off('room:message:new', socketHandler)
      window.removeEventListener('room:read', onRead as any)
    }
  }, [queryClient])

  const loadRooms = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['rooms'] })
    } catch (err) {
      console.error('Failed to load rooms', err)
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
      <div className="flex items-center justify-center min-h-[45vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hallway head — brass live rail */}
      <div className="paper overflow-hidden">
        <div className="h-[3px] bg-brass-400" />
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-surface-900 flex items-center justify-center">
              <DoorOpen size={18} className="text-brass-400" />
            </div>
            <div>
              <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none flex items-center gap-2">
                Hallway — Rooms
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-1">
                  <span className="live-dot live-dot--on" /> Live
                </span>
              </h1>
              <p className="text-xs text-surface-500 dark:text-night-400">Lockers, clubs, and study halls. Brass dot = live.</p>
            </div>
          </div>
          <button
            onClick={() => { resetForm(); setShowCreate(true) }}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 bg-primary-600 text-white rounded-xl hover:bg-primary-700 text-sm font-semibold"
          >
            <Plus size={16} /> New Locker
          </button>
        </div>
      </div>

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
          {filteredRooms.map((room) => {
            const roomType = getRoomType(room)
            const config = typeConfig[roomType]
            const TypeIcon = config.icon
            const isLive = (room.unreadCount||0) > 0 || (room._count?.members ?? 0) > 0
            return (
              <div
                key={room.id}
                onClick={() => navigate(`/rooms/${room.id}`)}
                className="paper p-5 flex flex-col cursor-pointer hover:shadow-e2 transition-shadow group relative overflow-hidden"
              >
                  {/* brass live rail + dot */}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-brass-400" />
                  <div className="flex items-start justify-between">
                    <div className="w-11 h-11 rounded-xl bg-surface-900 flex items-center justify-center">
                      <TypeIcon size={18} className="text-brass-400" />
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase border rounded-full px-2.5 py-1 bg-surface-50 dark:bg-night-800 text-surface-600 dark:text-night-300 border-surface-200 dark:border-night-600">
                      <span className={clsx('live-dot', isLive && 'live-dot--on')} /> {config.label}
                    </span>
                  </div>
                  <h3 className="mt-3 font-display font-bold text-surface-900 dark:text-night-50 text-lg line-clamp-1">{room.name}</h3>
                  {room.description && <p className="text-sm text-surface-500 dark:text-night-400 line-clamp-2 mt-1">{room.description}</p>}
                  <div className="mt-3 flex items-center gap-2 text-sm text-surface-500 dark:text-night-400">
                    <Users size={14} className="text-surface-400 dark:text-night-400" />
                    <span>{room._count?.members ?? room.members?.length ?? 0} members</span>
                    {room.unreadCount > 0 && <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-danger-500 text-white rounded-full text-[11px] font-bold">{room.unreadCount>99?'99+':room.unreadCount}</span>}
                  </div>
                  <div className="mt-3 p-2.5 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl flex items-center gap-2">
                    <KeyRound size={13} className="text-primary-600 shrink-0" />
                    <span className="font-mono font-bold text-surface-800 text-xs tracking-wider">{room.joinCode}</span>
                    <div className="flex gap-1 ml-auto">
                      <button onClick={(e) => copyJoinCode(room.joinCode, e)} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 dark:text-night-400 hover:text-primary-600 hover:bg-white dark:hover:bg-night-700 dark:bg-night-800 border border-transparent hover:border-surface-200 dark:border-night-600" title="Copy code"><Copy size={12} /></button>
                      <button onClick={(e) => shareJoinCode(room, e)} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-surface-400 dark:text-night-400 hover:text-primary-600 hover:bg-white dark:hover:bg-night-700 dark:bg-night-800 border border-transparent hover:border-surface-200 dark:border-night-600" title="Copy join link"><Share2 size={12} /></button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-surface-100 dark:border-night-600">
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/rooms/${room.id}`) }} className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700">
                      Open <ChevronRight size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); openEditModal(room) }} className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 dark:text-night-400 hover:text-primary-600 hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 border border-surface-200 dark:border-night-600" title="Edit"><Pencil size={14} /></button>
                    <button onClick={(e) => { e.stopPropagation(); openDeleteConfirm(room) }} className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-surface-400 dark:text-night-400 hover:text-danger-600 hover:bg-danger-50 border border-surface-200 dark:border-night-600" title="Delete"><Trash2 size={14} /></button>
                  </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Room" size="md">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 transition-colors"
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
            <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 dark:border-night-600 rounded-xl text-sm h-20 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowEdit(false); setEditRoom(null); resetForm() }}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 transition-colors"
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
          <p className="text-sm text-surface-600 dark:text-night-300">
            Are you sure you want to delete <span className="font-bold text-surface-900 dark:text-night-50">{deleteTarget?.name}</span>?
            This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { setShowDelete(false); setDeleteTarget(null) }}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200 transition-colors"
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

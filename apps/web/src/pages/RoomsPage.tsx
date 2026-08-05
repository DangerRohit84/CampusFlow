import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, BookOpen, Users, FileText, Copy, Share2,
  Trash2, Loader2, Pencil, ChevronRight, KeyRound
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'

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

  useEffect(() => {
    loadRooms()
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">My Rooms</h1>
          <p className="text-surface-500 text-sm mt-1">Manage your classrooms and share resources</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreate(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
        >
          <Plus size={16} /> Create Room
        </button>
      </div>

      {/* Room Grid */}
      {rooms.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="w-16 h-16 text-surface-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-surface-700">No rooms yet</h3>
          <p className="text-surface-400 mt-1">Create your first room to start sharing resources with students</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <motion.div
              key={room.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-surface-100 p-5 hover:shadow-lg transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
                    <BookOpen size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 line-clamp-1">{room.name}</h3>
                    {room.description && (
                      <p className="text-surface-500 text-xs line-clamp-1">{room.description}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-4 text-xs text-surface-500">
                  <span className="flex items-center gap-1">
                    <Users size={12} className="text-green-500" />
                    {room._count?.members ?? room.members?.length ?? 0} members
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText size={12} className="text-blue-500" />
                    {room._count?.resources ?? room.resources?.length ?? 0} resources
                  </span>
                </div>
              </div>

              {/* Join Code */}
              <div className="flex items-center gap-2 p-3 bg-surface-50 rounded-xl mb-4">
                <KeyRound size={14} className="text-primary-500 shrink-0" />
                <span className="text-xs text-surface-500 font-medium">Join Code:</span>
                <span className="font-mono font-bold text-surface-900 text-sm tracking-wider">{room.joinCode}</span>
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={(e) => copyJoinCode(room.joinCode, e)}
                    className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                    title="Copy code"
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    onClick={(e) => shareJoinCode(room, e)}
                    className="p-1.5 rounded-lg text-surface-400 hover:text-primary-500 hover:bg-primary-50 transition-colors"
                    title="Copy join link"
                  >
                    <Share2 size={13} />
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/rooms/${room.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
                >
                  Open <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => openEditModal(room)}
                  className="p-2 rounded-xl text-surface-400 hover:text-primary-500 hover:bg-primary-50 border border-surface-200 transition-all"
                  title="Edit"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => openDeleteConfirm(room)}
                  className="p-2 rounded-xl text-surface-400 hover:text-red-500 hover:bg-red-50 border border-surface-200 transition-all"
                  title="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.div>
          ))}
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
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm"
              placeholder="e.g., Data Structures"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-surface-700 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm h-20"
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => { setShowEdit(false); setEditRoom(null); resetForm() }}
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleEdit}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
              className="flex-1 px-4 py-2 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
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

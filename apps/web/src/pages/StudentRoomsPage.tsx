import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { roomAPI } from '../lib/api'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { qk } from '../lib/queryKeys'
import { useCollegeScope } from '../hooks/useCollegeScope'
import { notifyEntityMutated } from '../lib/entitySync'
import { motion } from 'framer-motion'
import {
  BookOpen, Users, FileText, ChevronRight, Loader2, DoorOpen
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../components/ui/Modal'
import CenteredLoader from '../components/ui/CenteredLoader'

export default function StudentRoomsPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showJoin, setShowJoin] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joining, setJoining] = useState(false)

  // STATE-SYNC: reactive scope — college switches change the key.
  const overrideScope = useCollegeScope()
  const { data: roomsData, isLoading: loading } = useQuery({
    queryKey: qk.rooms('student', (user as any)?.collegeId || overrideScope),
    queryFn: ({ signal }) => roomAPI.getAll({ signal } as any),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const rooms = (roomsData as any[]) ?? []

  const loadRooms = async () => {
    notifyEntityMutated('room')
  }

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase()
    if (!code || code.length !== 6) {
      toast.error('Please enter a valid 6-character code')
      return
    }

    setJoining(true)
    try {
      await roomAPI.joinByCodeOnly(code)
      toast.success('Joined room successfully!')
      setShowJoin(false)
      setJoinCode('')
      loadRooms()
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to join room'
      toast.error(message)
    } finally {
      setJoining(false)
    }
  }

  const handleCodeInput = (value: string) => {
    // Allow only alphanumeric and max 6 chars
    const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6)
    setJoinCode(cleaned)
  }

  if (loading) {
    return <CenteredLoader text="Loading rooms..." />
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">My Rooms</h1>
          <p className="text-surface-500 dark:text-night-400 text-sm mt-1">Access your classrooms and download resources</p>
        </div>
        <button
          onClick={() => { setJoinCode(''); setShowJoin(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
        >
          <DoorOpen size={16} /> Join Room
        </button>
      </div>

      {/* Room Grid */}
      {rooms.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="w-16 h-16 text-surface-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-surface-700 dark:text-night-200">No rooms yet</h3>
          <p className="text-surface-400 dark:text-night-400 mt-1 mb-4">Join a room using the code from your teacher</p>
          <button
            onClick={() => { setJoinCode(''); setShowJoin(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
          >
            <DoorOpen size={16} /> Join Room
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rooms.map((room) => (
            <motion.div
              key={room.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-night-800 rounded-2xl border border-surface-100 dark:border-night-600 p-5 hover:shadow-lg transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
                    <BookOpen size={18} className="text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-surface-900 dark:text-night-50 line-clamp-1">{room.name}</h3>
                    {room.teacher && (
                      <p className="text-surface-500 dark:text-night-400 text-xs line-clamp-1">Teacher: {room.teacher.name}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-4 text-xs text-surface-500 dark:text-night-400">
                  <span className="flex items-center gap-1">
                    <Users size={12} className="text-primary-500" />
                    {room._count?.members ?? room.members?.length ?? 0} members
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText size={12} className="text-primary-500" />
                    {room._count?.resources ?? room.resources?.length ?? 0} resources
                  </span>
                </div>
              </div>

              {/* Open Room Button */}
              <button
                onClick={() => navigate(`/rooms/${room.id}`)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all"
              >
                Open Room <ChevronRight size={14} />
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* Join Room Modal */}
      <Modal open={showJoin} onClose={() => setShowJoin(false)} title="Join a Room" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-surface-500 dark:text-night-400">
            Enter the 6-character join code provided by your teacher
          </p>
          <div>
            <label className="text-sm font-medium text-surface-700 dark:text-night-200 mb-1 block">Join Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => handleCodeInput(e.target.value)}
              className="w-full px-4 py-3 border border-surface-200 dark:border-night-600 rounded-xl text-sm text-center font-mono font-bold text-lg tracking-[0.3em] uppercase"
              placeholder="XXXXXX"
              maxLength={6}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && joinCode.length === 6) {
                  handleJoin()
                }
              }}
            />
            <p className="text-xs text-surface-400 dark:text-night-400 mt-1 text-center">
              {joinCode.length}/6 characters
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowJoin(false)}
              className="flex-1 px-4 py-2 bg-surface-100 dark:bg-night-700 text-surface-700 dark:text-night-200 rounded-xl font-medium hover:bg-surface-200"
            >
              Cancel
            </button>
            <button
              onClick={handleJoin}
              disabled={joining || joinCode.length !== 6}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {joining && <Loader2 size={14} className="animate-spin" />}
              Join
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

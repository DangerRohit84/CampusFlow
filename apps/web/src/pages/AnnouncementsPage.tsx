import { useState, useEffect, useCallback } from 'react'
import { Megaphone, Plus, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { announcementsAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import AnnouncementCard from '../components/AnnouncementCard'
import CreateAnnouncementModal from '../components/CreateAnnouncementModal'
import toast from 'react-hot-toast'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'

export default function AnnouncementsPage() {
  const { user } = useAuthStore()
  const [data, setData] = useState<{ announcements: any[]; pagination: any } | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [collegeFilter, setCollegeFilter] = useState<string>('')
  const [editingAnnouncement, setEditingAnnouncement] = useState<any | null>(null)

  const canCreate = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  // College list for filter dropdown
  const [colleges, setColleges] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (isSuperAdmin) {
      announcementsAPI.listColleges().then(setColleges).catch(() => {})
    }
  }, [isSuperAdmin])

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true)
    try {
      const result = await announcementsAPI.list(page, 10, isSuperAdmin && collegeFilter ? collegeFilter : undefined)
      setData(result)
      if (result.announcements?.length) {
        announcementsAPI.markAllRead(isSuperAdmin && collegeFilter ? collegeFilter : undefined).then(() => {
          setData((prev) => prev ? { ...prev, announcements: prev.announcements.map((a: any) => ({ ...a, isRead: true })), unreadCount: 0 } : prev)
        }).catch(() => {})
      }
    } catch {
      toast.error('Failed to load announcements')
    } finally {
      setLoading(false)
    }
  }, [page, collegeFilter, isSuperAdmin])

  useEffect(() => {
    fetchAnnouncements()
  }, [fetchAnnouncements])

  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await announcementsAPI.markRead(id)
      setData((prev) => prev ? { ...prev, announcements: prev.announcements.map((a: any) => a.id === id ? { ...a, isRead: true } : a) } : prev)
    } catch {}
  }, [])

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this announcement?')) return
    try {
      await announcementsAPI.delete(id)
      toast.success('Announcement deleted')
      fetchAnnouncements()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to delete')
    }
  }

  const handleEdit = (announcement: any) => {
    setEditingAnnouncement(announcement)
  }

  const announcements = data?.announcements || []
  const pagination = data?.pagination

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <PremiumHero
        icon={<Megaphone size={18} />}
        eyebrow={`Campus · Announcements · ${announcements.length} notices`}
        title={<>Announcements</>}
        subtitle="Stay updated with campus news — pinned, filtered and real-time. Glass, bento and motion for a premium 2025 feel."
        actions={
          canCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-primary-500 text-black text-[13px] font-black hover:bg-[#1ed760] shadow-[0_8px_20px_rgba(30,215,96,0.3)] transition-colors"
            >
              <Plus size={16} /> New Announcement
            </button>
          ) : undefined
        }
        stats={
          <GlassPanel className="p-4">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60">Notices</p>
            <p className="mt-1 font-display text-[26px] font-[800] leading-none text-white">{announcements.length}</p>
            <p className="mt-1 text-[11px] font-semibold text-white/60">{canCreate ? 'You can post' : 'Read-only'}</p>
            <div className="mt-3 h-px bg-white/10" />
            <div className="mt-3 flex items-center gap-2 text-[11px] font-medium text-white/60"><Filter size={12} className="text-primary-400"/> {isSuperAdmin ? 'Super admin view' : 'Campus scoped'}</div>
          </GlassPanel>
        }
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      {/* Super Admin College Filter */}
      {isSuperAdmin && (
        <div className="flex items-center gap-3">
          <Filter size={16} className="text-surface-400 dark:text-night-400" />
          <select
            value={collegeFilter}
            onChange={(e) => { setCollegeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-night-600 bg-white dark:bg-night-900 text-surface-900 dark:text-night-50 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-w-[200px]"
          >
            <option value="">All Colleges</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {collegeFilter && (
            <button
              onClick={() => { setCollegeFilter(''); setPage(1) }}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && !data && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white dark:bg-night-800 rounded-xl border border-gray-200 dark:border-night-600 p-5 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-surface-200 dark:bg-night-700" />
                <div className="flex-1">
                  <div className="h-4 bg-surface-200 dark:bg-night-700 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-surface-200 dark:bg-night-700 rounded w-1/4" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div className="h-3 bg-surface-200 dark:bg-night-700 rounded w-full" />
                <div className="h-3 bg-surface-200 dark:bg-night-700 rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Announcements list */}
      {!loading && announcements.length === 0 && (
        <div className="text-center py-16">
          <Megaphone size={48} className="mx-auto text-surface-300 dark:text-night-600 mb-4" />
          <h3 className="text-lg font-semibold text-surface-700 dark:text-night-200">No announcements yet</h3>
          <p className="text-sm text-surface-500 dark:text-night-400 mt-1">
            {canCreate ? 'Create the first announcement for your campus.' : 'Check back later for updates.'}
          </p>
        </div>
      )}

      <motion.div initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }} className="grid grid-cols-12 gap-4">
        {announcements.map((a: any, i: number) => (
          <motion.div key={a.id} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { delay: i * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] as any } } }} className="col-span-12">
            <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden hover:shadow-[0_12px_32px_rgba(0,0,0,0.08)] hover:border-surface-300 dark:hover:border-[#3a3a3a] transition-all">
              <AnnouncementCard
                announcement={a}
                canDelete={canDelete(a, user)}
                canEdit={canDelete(a, user)}
                onDelete={handleDelete}
                onEdit={handleEdit}
                isRead={a.isRead}
                onMarkRead={handleMarkRead}
              />
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg border border-surface-200 dark:border-night-600 disabled:opacity-40 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors"
          >
            <ChevronLeft size={16} className="text-surface-600 dark:text-night-300" />
          </button>
          <span className="text-sm text-surface-600 dark:text-night-300">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
            disabled={page === pagination.totalPages}
            className="p-2 rounded-lg border border-surface-200 dark:border-night-600 disabled:opacity-40 hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-700 transition-colors"
          >
            <ChevronRight size={16} className="text-surface-600 dark:text-night-300" />
          </button>
        </div>
      )}

      <CreateAnnouncementModal
        open={showCreate || !!editingAnnouncement}
        onClose={() => { setShowCreate(false); setEditingAnnouncement(null) }}
        onCreated={fetchAnnouncements}
        announcement={editingAnnouncement}
      />
    </div>
  )
}

function canDelete(announcement: any, user: any): boolean {
  if (!user) return false
  if (user.role === 'SUPER_ADMIN') return true
  if (user.role === 'COLLEGE_ADMIN') return announcement.collegeId === user.collegeId
  return announcement.creator?.id === user.id
}

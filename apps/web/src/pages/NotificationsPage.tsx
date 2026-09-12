import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, BellOff, CheckCheck, Trash2, Users, Clock, Check } from 'lucide-react'
import { notificationAPI } from '../lib/api'
import { notifyEntityMutated, useEntitySync } from '../lib/entitySync'
import { applyMarkRead, applyMarkAllRead, applyDelete } from '../lib/notificationHelpers'
import toast from 'react-hot-toast'
import CenteredLoader from '../components/ui/CenteredLoader'

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = () => {
    setLoadError(null)
    notificationAPI.getAll().then((data: any[]) => {
      setNotifs(Array.isArray(data) ? data : [])
    }).catch((e: any) => {
      const msg = e?.response?.data?.error || 'Could not load notifications.'
      setLoadError(msg)
      toast.error(msg)
    }).finally(() => setLoading(false))
  }
  // FILTER-NOREFETCH (PERPAGE-HALF2): All/Unread is a client-side filter over
  // the single cached list (see `filtered` below) — depending on `filter`
  // refetched GET /notifications on every tab toggle for the identical
  // payload. Mount + entity-sync only; toggles never hit the network.
  useEffect(() => { load() }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // STATE-SYNC: new pushes (socket) + reads/deletes elsewhere refresh here.
  useEntitySync(['notification', 'announcement', 'room'], load)

  const filtered = filter === 'unread' ? notifs.filter(n => !n.isRead) : notifs
  const unreadCount = notifs.filter(n => !n.isRead).length

  const markRead = async (id: string) => {
    const prev = notifs
    setNotifs((p) => applyMarkRead(p, id))
    try {
      await notificationAPI.markRead(id)
      notifyEntityMutated('notification', { notificationId: id, action: 'read' })
    } catch (e: any) {
      setNotifs(prev)
      toast.error(e?.response?.data?.error || 'Could not mark as read.')
    }
  }
  const markAllRead = async () => {
    const prev = notifs
    setNotifs((p) => applyMarkAllRead(p))
    try {
      await notificationAPI.markAllRead()
      notifyEntityMutated('notification', { action: 'read-all' })
    } catch (e: any) {
      setNotifs(prev)
      toast.error(e?.response?.data?.error || 'Could not mark all read.')
    }
  }
  const deleteNotif = async (id: string) => {
    const prev = notifs
    setNotifs((p) => applyDelete(p, id))
    try {
      await notificationAPI.delete(id)
      notifyEntityMutated('notification', { notificationId: id, action: 'deleted' })
      toast.success('Notification deleted')
    } catch (e: any) {
      setNotifs(prev)
      toast.error(e?.response?.data?.error || 'Could not delete notification.')
    }
  }

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-[1280px] mx-auto">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">Notifications</h1>
          <p className="text-surface-500 dark:text-night-400 mt-1">{unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-300 hover:bg-surface-200 transition-all">
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex items-center gap-2">
        <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'all' ? 'bg-surface-900 text-white' : 'bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-300 hover:bg-surface-200'}`}>All ({notifs.length})</button>
        <button onClick={() => setFilter('unread')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'unread' ? 'bg-surface-900 text-white' : 'bg-surface-100 dark:bg-night-700 text-surface-600 dark:text-night-300 hover:bg-surface-200'}`}>Unread ({unreadCount})</button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
        {loading ? (
          <CenteredLoader text="Loading notifications..." minHeight="min-h-[320px]" />
        ) : loadError ? (
          <div className="text-center py-16 rounded-2xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-800" role="alert">
            <p className="font-semibold text-surface-700 dark:text-night-200">Couldn&apos;t load notifications</p>
            <p className="text-sm text-surface-500 dark:text-night-400 mt-1">{loadError}</p>
            <button onClick={load} className="mt-4 px-5 py-2.5 rounded-xl bg-surface-900 text-white text-sm font-semibold hover:bg-surface-800">Retry</button>
          </div>
        ) : (
          <AnimatePresence>
            {filtered.map((notif: any) => (
              <motion.div key={notif.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} layout>
                <div className={`p-4 rounded-xl border transition-all hover:shadow-sm ${!notif.isRead ? 'border-primary-200 bg-primary-50/30' : 'border-surface-100 dark:border-night-600 bg-white dark:bg-night-800'}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                      <Bell size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold text-sm ${!notif.isRead ? 'text-surface-900 dark:text-night-50' : 'text-surface-700'}`}>{notif.message}</p>
                            {!notif.isRead && <span className="w-2 h-2 bg-primary-500 rounded-full shrink-0" />}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            {notif.room && (
                              <span className="text-xs text-surface-400 dark:text-night-400 flex items-center gap-1">
                                <Users size={12} /> {notif.room.name}
                              </span>
                            )}
                            <span className="text-xs text-surface-400 dark:text-night-400 flex items-center gap-1">
                              <Clock size={12} /> {getTimeAgo(notif.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!notif.isRead && (
                            <button onClick={() => markRead(notif.id)} className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Mark as read">
                              <Check size={14} />
                            </button>
                          )}
                          <button onClick={() => deleteNotif(notif.id)} className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-danger-600 hover:bg-danger-50 transition-colors" title="Delete">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
        {!loading && !loadError && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-surface-100 dark:bg-night-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BellOff className="w-8 h-8 text-surface-400 dark:text-night-400" />
            </div>
            <p className="text-surface-500 dark:text-night-400 font-medium">No notifications</p>
            <p className="text-sm text-surface-400 dark:text-night-400 mt-1">{filter === 'unread' ? "You're all caught up!" : "No notifications yet"}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, BellOff, CheckCheck, Trash2, Users, Clock, Check } from 'lucide-react'
import { notificationAPI } from '../lib/api'

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)

  const load = () => {
    notificationAPI.getAll().then((data: any[]) => {
      setNotifs(data)
    }).catch(console.error).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [filter])

  const filtered = filter === 'unread' ? notifs.filter(n => !n.isRead) : notifs
  const unreadCount = notifs.filter(n => !n.isRead).length

  const markRead = async (id: string) => {
    await notificationAPI.markRead(id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
  }
  const markAllRead = async () => {
    await notificationAPI.markAllRead()
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })))
  }
  const deleteNotif = async (id: string) => {
    await notificationAPI.delete(id)
    setNotifs(prev => prev.filter(n => n.id !== id))
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-extrabold text-surface-900 leading-none">Notifications</h1>
          <p className="text-surface-500 mt-1">{unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-surface-100 text-surface-600 hover:bg-surface-200 transition-all">
            <CheckCheck size={16} /> Mark all read
          </button>
        )}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex items-center gap-2">
        <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'all' ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>All ({notifs.length})</button>
        <button onClick={() => setFilter('unread')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'unread' ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>Unread ({unreadCount})</button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
        {loading ? (
          <div className="text-center py-12 text-surface-400">Loading...</div>
        ) : (
          <AnimatePresence>
            {filtered.map((notif: any) => (
              <motion.div key={notif.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} layout>
                <div className={`p-4 rounded-xl border transition-all hover:shadow-sm ${!notif.isRead ? 'border-primary-200 bg-primary-50/30' : 'border-surface-100 bg-white'}`}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
                      <Bell size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold text-sm ${!notif.isRead ? 'text-surface-900' : 'text-surface-700'}`}>{notif.message}</p>
                            {!notif.isRead && <span className="w-2 h-2 bg-primary-500 rounded-full shrink-0" />}
                          </div>
                          <div className="flex items-center gap-3 mt-1.5">
                            {notif.room && (
                              <span className="text-xs text-surface-400 flex items-center gap-1">
                                <Users size={12} /> {notif.room.name}
                              </span>
                            )}
                            <span className="text-xs text-surface-400 flex items-center gap-1">
                              <Clock size={12} /> {getTimeAgo(notif.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!notif.isRead && (
                            <button onClick={() => markRead(notif.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-primary-600 hover:bg-primary-50 transition-colors" title="Mark as read">
                              <Check size={14} />
                            </button>
                          )}
                          <button onClick={() => deleteNotif(notif.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-danger-600 hover:bg-danger-50 transition-colors" title="Delete">
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
        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BellOff className="w-8 h-8 text-surface-400" />
            </div>
            <p className="text-surface-500 font-medium">No notifications</p>
            <p className="text-sm text-surface-400 mt-1">{filter === 'unread' ? "You're all caught up!" : "No notifications yet"}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

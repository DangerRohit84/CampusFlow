import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, BellOff, Check, CheckCheck, Trash2, Calendar, BookOpen, AlertTriangle, Users, Clock, Settings } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { notificationAPI } from '../lib/api'

const typeIcons: Record<string, React.ElementType> = { EXAM: AlertTriangle, ASSIGNMENT: BookOpen, EVENT: Users, ATTENDANCE: Clock, GENERAL: Bell }
const typeColors: Record<string, string> = { EXAM: 'bg-red-100 text-red-600', ASSIGNMENT: 'bg-primary-100 text-primary-600', EVENT: 'bg-accent-100 text-accent-600', ATTENDANCE: 'bg-amber-100 text-amber-600', GENERAL: 'bg-surface-100 text-surface-600' }

export default function NotificationsPage() {
  const [notifs, setNotifs] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)

  const load = () => {
    notificationAPI.getAll(filter === 'unread').then(setNotifs).catch(console.error).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [filter])

  const unreadCount = notifs.filter((n) => !n.read).length
  const markRead = async (id: string) => { await notificationAPI.markRead(id); load() }
  const markAllRead = async () => { await notificationAPI.markAllRead(); load() }
  const deleteNotif = async (id: string) => { await notificationAPI.delete(id); load() }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-surface-900">Notifications</h1>
          <p className="text-surface-500 mt-1">{unreadCount} unread notifications</p>
        </div>
        <Button variant="secondary" size="sm" onClick={markAllRead}><CheckCheck size={16} /> Mark all read</Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex items-center gap-2">
        <button onClick={() => setFilter('all')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'all' ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>All ({notifs.length})</button>
        <button onClick={() => setFilter('unread')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === 'unread' ? 'bg-surface-900 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>Unread ({unreadCount})</button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
        {loading ? <div className="text-center py-12 text-surface-400">Loading...</div> : <AnimatePresence>
          {notifs.map((notif: any) => {
            const Icon = typeIcons[notif.type] || Bell
            return (
              <motion.div key={notif.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} layout>
                <Card hover className={`group ${!notif.read ? 'border-primary-200 bg-primary-50/30' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${typeColors[notif.type] || typeColors.GENERAL}`}><Icon size={20} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className={`font-bold ${!notif.read ? 'text-surface-900' : 'text-surface-700'}`}>{notif.title}</h3>
                            {!notif.read && <span className="w-2 h-2 bg-primary-500 rounded-full" />}
                          </div>
                          <p className="text-sm text-surface-500 mt-1">{notif.message}</p>
                        </div>
                        {notif.priority === 'URGENT' && <Badge variant="danger" dot>Urgent</Badge>}
                        {notif.priority === 'HIGH' && <Badge variant="warning" dot>High</Badge>}
                      </div>
                      <div className="flex items-center gap-4 mt-3">
                        <span className="text-xs text-surface-400 flex items-center gap-1"><Clock size={12} /> {new Date(notif.createdAt).toLocaleDateString()}</span>
                        <div className="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                          {!notif.read && <button onClick={() => markRead(notif.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors" title="Mark as read"><Check size={14} /></button>}
                          <button onClick={() => deleteNotif(notif.id)} className="p-1.5 rounded-lg text-surface-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </AnimatePresence>}
        {!loading && notifs.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><BellOff className="w-8 h-8 text-surface-400" /></div>
            <p className="text-surface-500 font-medium">No notifications</p>
            <p className="text-sm text-surface-400 mt-1">{filter === 'unread' ? "You're all caught up!" : "No notifications yet"}</p>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
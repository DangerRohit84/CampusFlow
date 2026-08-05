import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  User, Building2, GraduationCap, Bell, Palette, Link2, Moon, Sun, Monitor,
  Camera, Save, LogOut
} from 'lucide-react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import { useAuthStore } from '../store/authStore'
import { userAPI } from '../lib/api'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { user, logout } = useAuthStore()
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light')
  const [profile, setProfile] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { userAPI.getProfile().then(setProfile).catch(console.error) }, [])

  const handleSaveProfile = async () => {
    setSaving(true)
    try { await userAPI.updateProfile(profile); toast.success('Profile saved!') } catch { toast.error('Failed to save') }
    setSaving(false)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-3xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-500 mt-1">Manage your account and preferences</p>
      </motion.div>

      {/* Profile */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <Card>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-surface-900">Profile</h2>
            <Badge variant="primary">{user?.role || 'Student'}</Badge>
          </div>
          <div className="flex items-center gap-5 mb-8 p-4 bg-surface-50 rounded-2xl">
            <div className="relative">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white text-2xl font-bold shadow-lg">{user?.name?.charAt(0) || 'A'}</div>
              <button className="absolute -bottom-1 -right-1 w-8 h-8 bg-white border-2 border-surface-200 rounded-xl flex items-center justify-center text-surface-500 hover:text-primary-600 hover:border-primary-300 transition-colors shadow-sm"><Camera size={14} /></button>
            </div>
            <div>
              <h3 className="font-bold text-surface-900 text-lg">{user?.name || 'Alex Johnson'}</h3>
              <p className="text-sm text-surface-500">{user?.email || 'alex@university.edu'}</p>
              <p className="text-xs text-surface-400 mt-1">{user?.department?.name || 'No department'}</p>
              {(user?.studentId || user?.empNumber) && (
                <p className="text-xs text-surface-400 mt-0.5">
                  {user?.role === 'STUDENT' ? `Roll No: ${user.studentId}` : `Emp No: ${user.empNumber}`}
                </p>
              )}
              {user?.college?.name && (
                <p className="text-xs text-surface-400 mt-0.5">{user.college.name}</p>
              )}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <Input label="Full Name" defaultValue={user?.name || 'Alex Johnson'} icon={<User size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, name: e.target.value }))} />
            <Input label="Department" defaultValue={user?.department?.name || ''} icon={<Building2 size={18} />} disabled />
            <Input label="Roll No / Emp No" defaultValue={user?.studentId || user?.empNumber || ''} icon={<GraduationCap size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, studentId: e.target.value }))} disabled />
            <Input label="College Name" defaultValue={user?.college?.name || ''} icon={<Building2 size={18} />} onChange={(e) => setProfile((p: any) => ({ ...p, collegeName: e.target.value }))} disabled />
          </div>
          <div className="mt-6 flex justify-end"><Button onClick={handleSaveProfile} loading={saving}><Save size={16} /> Save Changes</Button></div>
        </Card>
      </motion.div>

      {/* Notifications */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center"><Bell className="w-5 h-5 text-primary-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Notifications</h2>
          </div>
          <div className="space-y-4">
            {[
              { label: 'Assignment Deadlines', desc: 'Get notified before deadlines', checked: true },
              { label: 'Exam Updates', desc: 'Schedule changes and announcements', checked: true },
              { label: 'Event Reminders', desc: 'Campus events and activities', checked: true },
              { label: 'Attendance Alerts', desc: 'Low attendance warnings', checked: true },
            ].map((n) => (
              <div key={n.label} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-50 transition-colors">
                <div><p className="text-sm font-semibold text-surface-900">{n.label}</p><p className="text-xs text-surface-400">{n.desc}</p></div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked={n.checked} className="sr-only peer" />
                  <div className="w-11 h-6 bg-surface-200 peer-focus:ring-2 peer-focus:ring-primary-500/20 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
                </label>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Appearance */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center"><Palette className="w-5 h-5 text-accent-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Appearance</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[{ value: 'light', icon: Sun, label: 'Light' }, { value: 'dark', icon: Moon, label: 'Dark' }, { value: 'system', icon: Monitor, label: 'System' }].map((t) => (
              <button key={t.value} onClick={() => setTheme(t.value as any)} className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${theme === t.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-200 hover:border-surface-300 text-surface-600'}`}>
                <t.icon size={24} /><span className="text-sm font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Integrations */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
        <Card>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center"><Link2 className="w-5 h-5 text-emerald-600" /></div>
            <h2 className="text-lg font-bold text-surface-900">Integrations</h2>
          </div>
          <div className="space-y-3">
            {[
              { name: 'Google Calendar', icon: '📅', connected: false, color: 'bg-blue-100' },
              { name: 'LMS (Moodle)', icon: '📚', connected: false, color: 'bg-orange-100' },
              { name: 'Gmail', icon: '✉️', connected: false, color: 'bg-red-100' },
              { name: 'WhatsApp', icon: '💬', connected: false, color: 'bg-green-100' },
            ].map((i) => (
              <div key={i.name} className="flex items-center justify-between p-4 rounded-xl border border-surface-100 hover:border-surface-200 transition-colors">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl ${i.color} flex items-center justify-center text-lg`}>{i.icon}</div>
                  <div><p className="text-sm font-semibold text-surface-900">{i.name}</p><p className="text-xs text-surface-400">{i.connected ? 'Connected' : 'Not connected'}</p></div>
                </div>
                <button className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${i.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>{i.connected ? 'Connected' : 'Connect'}</button>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Sign Out */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-red-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center"><LogOut className="w-5 h-5 text-red-600" /></div>
              <div><h3 className="font-bold text-surface-900">Sign Out</h3><p className="text-xs text-surface-400">Sign out from all devices</p></div>
            </div>
            <Button variant="danger" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </Card>
      </motion.div>

    </motion.div>
  )
}

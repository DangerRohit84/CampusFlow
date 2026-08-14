import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  User, Building2, GraduationCap, Bell,
  Camera, Save, LogOut, Code, Loader2, CheckCircle, ExternalLink, RefreshCw
} from 'lucide-react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import { useAuthStore } from '../store/authStore'
import { userAPI, codingProfileAPI } from '../lib/api'
import toast from 'react-hot-toast'

const codingPlatforms = [
  { key: 'leetcodeHandle', label: 'LeetCode', color: 'bg-yellow-500', url: 'https://leetcode.com/' },
  { key: 'codeforcesHandle', label: 'Codeforces', color: 'bg-blue-500', url: 'https://codeforces.com/profile/' },
  { key: 'codechefHandle', label: 'CodeChef', color: 'bg-amber-600', url: 'https://www.codechef.com/users/' },
  { key: 'hackerrankHandle', label: 'HackerRank', color: 'bg-green-600', url: 'https://www.hackerrank.com/' },
  { key: 'gfgHandle', label: 'GeeksforGeeks', color: 'bg-emerald-600', url: 'https://www.geeksforgeeks.org/user/' },
]

export default function SettingsPage() {
  const { user, logout } = useAuthStore()
  const [profile, setProfile] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [codingProfile, setCodingProfile] = useState<any>(null)
  const [codingHandles, setCodingHandles] = useState<Record<string, string>>({})
  const [codingLoading, setCodingLoading] = useState(true)
  const [codingSaving, setCodingSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [participations, setParticipations] = useState<any[]>([])

  useEffect(() => { userAPI.getProfile().then(setProfile).catch(console.error) }, [])

  useEffect(() => {
    codingProfileAPI.get().then((data) => {
      setCodingProfile(data)
      setCodingHandles({
        leetcodeHandle: data?.leetcodeHandle || '',
        codeforcesHandle: data?.codeforcesHandle || '',
        codechefHandle: data?.codechefHandle || '',
        hackerrankHandle: data?.hackerrankHandle || '',
        gfgHandle: data?.gfgHandle || '',
      })
    }).catch(() => {}).finally(() => setCodingLoading(false))
    codingProfileAPI.getParticipations().then(setParticipations).catch(() => {})
  }, [])

  const handleSaveCoding = async () => {
    setCodingSaving(true)
    try {
      await codingProfileAPI.update(codingHandles)
      toast.success('Coding profiles saved!')
      codingProfileAPI.get().then(setCodingProfile)
    } catch { toast.error('Failed to save') }
    setCodingSaving(false)
  }

  const handleSyncCoding = async () => {
    setSyncing(true)
    try {
      const result = await codingProfileAPI.sync()
      toast.success(`Synced ${result.synced} records from ${result.platforms.join(', ') || 'none'}`)
      codingProfileAPI.get().then(setCodingProfile)
      codingProfileAPI.getParticipations().then(setParticipations)
    } catch { toast.error('Sync failed') }
    setSyncing(false)
  }

  const filledCount = Object.values(codingHandles).filter(Boolean).length

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
        <Card hover>
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
        <Card hover>
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

      {/* Coding Profiles */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center"><Code className="w-5 h-5 text-white" /></div>
            <div>
              <h2 className="text-lg font-bold text-surface-900">Coding Profiles</h2>
              <p className="text-xs text-surface-400">Link your coding platform accounts to track contest participation</p>
            </div>
          </div>

          {codingLoading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-primary-500" size={24} /></div>
          ) : (
            <>
              <div className="space-y-3">
                {codingPlatforms.map((p) => (
                  <div key={p.key} className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${p.color}`} />
                    <label className="w-32 text-sm font-medium text-surface-700">{p.label}</label>
                    <input
                      type="text"
                      value={codingHandles[p.key] || ''}
                      onChange={(e) => setCodingHandles({ ...codingHandles, [p.key]: e.target.value })}
                      placeholder={`Your ${p.label} handle`}
                      className="flex-1 px-3 py-2 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    />
                    {codingHandles[p.key] && (
                      <a href={`${p.url}${codingHandles[p.key]}`} target="_blank" rel="noopener noreferrer"
                        className="p-2 text-surface-400 hover:text-primary-500">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 mt-5">
                <Button onClick={handleSaveCoding} loading={codingSaving} size="sm">
                  <CheckCircle size={14} /> Save Profiles
                </Button>
                <button onClick={handleSyncCoding} disabled={syncing || filledCount === 0}
                  className="px-4 py-2 bg-surface-100 text-surface-700 rounded-xl text-sm font-medium hover:bg-surface-200 disabled:opacity-50 flex items-center gap-2">
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Sync Now
                </button>
              </div>

              {codingProfile?.lastSyncedAt && (
                <p className="text-xs text-surface-400 mt-3">
                  Last synced: {new Date(codingProfile.lastSyncedAt).toLocaleString()}
                </p>
              )}

              {participations.length > 0 && (
                <div className="mt-5 pt-5 border-t border-surface-100">
                  <h3 className="text-sm font-bold text-surface-900 mb-3">Contest History ({participations.length})</h3>
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {participations.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
                        <div>
                          <p className="text-sm font-medium text-surface-900">{p.contestName}</p>
                          <p className="text-xs text-surface-400">{p.platform} {p.participatedAt ? `• ${new Date(p.participatedAt).toLocaleDateString()}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          {p.rank && <span className="text-surface-600">#{p.rank}</span>}
                          {p.rating && <span className="font-medium text-primary-600">{p.rating}</span>}
                          {p.ratingChange && (
                            <span className={p.ratingChange > 0 ? 'text-green-600' : 'text-red-600'}>
                              {p.ratingChange > 0 ? '+' : ''}{p.ratingChange}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </motion.div>

      {/* Sign Out */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card hover className="border-red-200">
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

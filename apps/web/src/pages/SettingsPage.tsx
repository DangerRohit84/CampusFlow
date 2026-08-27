import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  User, Bell, Camera, Save, LogOut, Code, Loader2, CheckCircle, ExternalLink, RefreshCw, Lock, Sun, Moon, Monitor
} from 'lucide-react'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import { useAuthStore } from '../store/authStore'
import { userAPI, codingProfileAPI, waitForCodingSync } from '../lib/api'
import toast from 'react-hot-toast'

const codingPlatforms = [
  { key: 'leetcodeHandle', label: 'LeetCode', color: 'bg-yellow-500', url: 'https://leetcode.com/' },
  { key: 'codeforcesHandle', label: 'Codeforces', color: 'bg-primary-500', url: 'https://codeforces.com/profile/' },
  { key: 'codechefHandle', label: 'CodeChef', color: 'bg-warning-600', url: 'https://www.codechef.com/users/' },
  { key: 'hackerrankHandle', label: 'HackerRank', color: 'bg-primary-600', url: 'https://www.hackerrank.com/' },
  { key: 'gfgHandle', label: 'GeeksforGeeks', color: 'bg-primary-600', url: 'https://www.geeksforgeeks.org/user/' },
]

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
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
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    sms: false,
  })

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
    if (syncing) return
    const baseline = codingProfile?.lastSyncedAt ? new Date(codingProfile.lastSyncedAt).getTime() : 0
    setSyncing(true)
    try {
      const result = await codingProfileAPI.sync()
      if (result?.skipped) {
        if (result.reason === 'no-handles') {
          // Server refused to start a job because no handles are configured —
          // inform instead of polling until timeout.
          toast(result.message || 'Add at least one coding platform handle first', { icon: 'ℹ️' })
        } else {
          toast.success('Stats are already up to date')
        }
        setSyncing(false)
        return
      }
    } catch {
      toast.error('Sync failed')
      setSyncing(false)
      return
    }
    toast.success('Syncing your profiles...')
    const { completed } = await waitForCodingSync(baseline)
    if (completed) toast.success('Profiles synced!')
    else toast.error('Sync is taking longer than expected')
    codingProfileAPI.get().then(setCodingProfile).catch(() => {})
    codingProfileAPI.getParticipations().then(setParticipations).catch(() => {})
    setSyncing(false)
  }

  const filledCount = Object.values(codingHandles).filter(Boolean).length

  const handleSaveProfile = async () => {
    setSaving(true)
    try { await userAPI.updateProfile(profile); toast.success('Profile saved!') } catch { toast.error('Failed to save') }
    setSaving(false)
  }

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="space-y-6 max-w-4xl"
    >
      {/* Page Header */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }}
      >
        <h1 className="text-3xl font-bold text-surface-900">Settings</h1>
        <p className="text-surface-500 mt-1">Manage your account preferences and configurations</p>
      </motion.div>

      {/* Profile Section */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.05 }}
      >
        <Card hover>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-surface-900">Profile</h2>
            <Badge variant="primary">{user?.role || 'Student'}</Badge>
          </div>
          
          <div className="flex flex-col md:flex-row gap-8">
            {/* Avatar Section */}
            <div className="flex flex-col items-center md:items-start gap-4">
              <div className="relative group">
                <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary-400 via-primary-500 to-primary-500 flex items-center justify-center text-white text-4xl font-bold shadow-lg ring-4 ring-white">
                  {user?.name?.charAt(0) || 'A'}
                </div>
                <button className="absolute inset-0 w-full h-full rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  <Camera size={24} className="text-white" />
                </button>
              </div>
              <button className="px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors">
                Change Avatar
              </button>
            </div>

            {/* Form Fields */}
            <div className="flex-1 space-y-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">First Name</label>
                  <input
                    type="text"
                    defaultValue={user?.name?.split(' ')[0] || 'Alex'}
                    onChange={(e) => setProfile((p: any) => ({ ...p, firstName: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Last Name</label>
                  <input
                    type="text"
                    defaultValue={user?.name?.split(' ').slice(1).join(' ') || 'Johnson'}
                    onChange={(e) => setProfile((p: any) => ({ ...p, lastName: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1.5">Email</label>
                <div className="relative">
                  <input
                    type="email"
                    defaultValue={user?.email || 'alex@university.edu'}
                    disabled
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg text-surface-500 bg-surface-50 cursor-not-allowed"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400">
                    <Lock size={16} />
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Phone</label>
                  <input
                    type="tel"
                    defaultValue={(user as any)?.phone || ''}
                    placeholder="Enter phone number"
                    onChange={(e) => setProfile((p: any) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-surface-700 mb-1.5">Student ID</label>
                  <input
                    type="text"
                    defaultValue={user?.studentId || user?.empNumber || ''}
                    disabled
                    className="w-full px-4 py-2.5 border border-surface-300 rounded-lg text-surface-500 bg-surface-50 cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveProfile} loading={saving}>
                  <Save size={16} /> Save Changes
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Notification Preferences */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.1 }}
      >
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <Bell className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-surface-900">Notification Preferences</h2>
              <p className="text-xs text-surface-500">Choose how you want to be notified</p>
            </div>
          </div>

          <div className="space-y-4">
            {/* Email Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors">
              <div>
                <p className="text-sm font-medium text-surface-700">Email Notifications</p>
                <p className="text-xs text-surface-500">Receive updates and alerts via email</p>
              </div>
              <button
                onClick={() => toggleNotification('email')}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                  notifications.email ? 'bg-primary-500' : 'bg-surface-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    notifications.email ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Push Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors">
              <div>
                <p className="text-sm font-medium text-surface-700">Push Notifications</p>
                <p className="text-xs text-surface-500">Get real-time notifications in your browser</p>
              </div>
              <button
                onClick={() => toggleNotification('push')}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                  notifications.push ? 'bg-primary-500' : 'bg-surface-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    notifications.push ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* SMS Notifications */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-surface-50 hover:bg-surface-100 transition-colors">
              <div>
                <p className="text-sm font-medium text-surface-700">SMS Notifications</p>
                <p className="text-xs text-surface-500">Receive important alerts via text message</p>
              </div>
              <button
                onClick={() => toggleNotification('sms')}
                className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
                  notifications.sms ? 'bg-primary-500' : 'bg-surface-300'
                }`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    notifications.sms ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Appearance */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.15 }}
      >
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <Sun className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-surface-900">Appearance</h2>
              <p className="text-xs text-surface-500">Customize how CampusFlow looks on your device</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTheme(value as typeof theme)}
                className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all ${
                  theme === value
                    ? 'border-primary-500 bg-primary-50 shadow-sm'
                    : 'border-surface-200 hover:border-surface-300 bg-white'
                }`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  theme === value ? 'bg-primary-100 text-primary-600' : 'bg-surface-100 text-surface-500'
                }`}>
                  <Icon size={24} />
                </div>
                <span className={`text-sm font-medium ${
                  theme === value ? 'text-primary-600' : 'text-surface-700'
                }`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </motion.div>

      {/* Coding Profiles */}
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.2 }}
      >
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-500 flex items-center justify-center">
              <Code className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-surface-900">Coding Profiles</h2>
              <p className="text-xs text-surface-500">Link your coding platform accounts to track contest participation</p>
            </div>
          </div>

          {codingLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-primary-500" size={24} />
            </div>
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
                      className="flex-1 px-3 py-2 border border-surface-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                    />
                    {codingHandles[p.key] && (
                      <a href={`${p.url}${codingHandles[p.key]}`} target="_blank" rel="noopener noreferrer"
                        className="p-2 text-surface-400 hover:text-primary-500 transition-colors">
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
                <button 
                  onClick={handleSyncCoding} 
                  disabled={syncing || filledCount === 0}
                  className="px-4 py-2 bg-surface-100 text-surface-700 rounded-lg text-sm font-medium hover:bg-surface-200 disabled:opacity-50 flex items-center gap-2 transition-colors"
                >
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
                <div className="mt-5 pt-5 border-t border-surface-200">
                  <h3 className="text-sm font-bold text-surface-900 mb-3">Contest History ({participations.length})</h3>
                  <div className="space-y-2 max-h-[240px] overflow-y-auto">
                    {participations.slice(0, 10).map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-surface-50 rounded-xl">
                        <div>
                          <p className="text-sm font-medium text-surface-900">{p.contestName}</p>
                          <p className="text-xs text-surface-500">{p.platform} {p.participatedAt ? `• ${new Date(p.participatedAt).toLocaleDateString()}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          {p.rank && <span className="text-surface-600">#{p.rank}</span>}
                          {p.rating && <span className="font-medium text-primary-600">{p.rating}</span>}
                          {p.ratingChange && (
                            <span className={p.ratingChange > 0 ? 'text-primary-600' : 'text-danger-600'}>
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
      <motion.div 
        initial={{ opacity: 0, y: 10 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 0.25 }}
      >
        <Card hover className="border-danger-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger-100 flex items-center justify-center">
                <LogOut className="w-5 h-5 text-danger-600" />
              </div>
              <div>
                <h3 className="font-bold text-surface-900">Sign Out</h3>
                <p className="text-xs text-surface-500">Sign out from all devices</p>
              </div>
            </div>
            <Button variant="danger" size="sm" onClick={logout}>Sign Out</Button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}

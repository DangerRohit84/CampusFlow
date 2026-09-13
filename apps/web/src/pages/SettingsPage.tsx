import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { User, Bell, Camera, Save, LogOut, Code, Loader2, CheckCircle, ExternalLink, RefreshCw, Lock, Sun, Moon, Monitor, Settings2, Shield, Eye, EyeOff, Sparkles, KeyRound, Zap } from 'lucide-react'
import Button from '../components/ui/Button'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { LOGOUT_DEST } from '../lib/logout'
import { userAPI, codingProfileAPI, waitForCodingSync, authAPI } from '../lib/api'
import { useLanguage } from '../i18n/LanguageContext'
import { SUPPORTED_LOCALES } from '../i18n/index'
import toast from 'react-hot-toast'
import { PremiumHero, GlassPanel, BentoGrid, SectionCard } from '../components/premium/PremiumKit'
import clsx from 'clsx'

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
  // WHY logout race: whole-store destructure re-rendered on set() and raced
  // navigate(); selectors keep logout stable. Deterministic replace to /login
  // (not ProtectedRoute bounce) keeps logout <300ms with no dashboard flash.
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const updateUser = useAuthStore((s) => s.updateUser)
  const navigate = useNavigate()
  const { locale, setLocale, t } = useLanguage()
  const [profile, setProfile] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [username, setUsername] = useState('')
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [codingProfile, setCodingProfile] = useState<any>(null)
  const [codingHandles, setCodingHandles] = useState<Record<string, string>>({})
  const [codingLoading, setCodingLoading] = useState(true)
  const [codingSaving, setCodingSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [participations, setParticipations] = useState<any[]>([])
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [portfolioSaving, setPortfolioSaving] = useState(false)
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    sms: false,
  })
  // Change password state — premium security
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [changeSaving, setChangeSaving] = useState(false)
  // #12 self-delete danger zone — double confirm (password + type DELETE)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [showDeletePassword, setShowDeletePassword] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { 
    // SINGLE-IDENTITY-FETCH (PERPAGE-HALF2): getProfile already returns
    // username + portfolioUrl — the removed parallel authAPI.me() fetched the
    // same identity twice per mount (2 GETs, last-write-wins on both fields).
    userAPI.getProfile().then((p)=>{ setProfile(p); if(p?.username) setUsername(p.username); if(p?.portfolioUrl) setPortfolioUrl(p.portfolioUrl) }).catch(console.error)
  }, [])

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
  const normalizePortfolio = (input: string): string | null => {
    const raw = String(input||'').trim()
    if (!raw) return null
    let c = raw
    if (!/^https?:\/\//i.test(c)) c = 'https://' + c
    try { const u = new URL(c); if (u.protocol!=='http:' && u.protocol!=='https:') return null; if (!u.hostname.includes('.') && u.hostname!=='localhost') return null; return u.toString() } catch { return null }
  }
  // WHY render-crash: `new URL(portfolioUrl)` in JSX threw on invalid input
  // (e.g. "not a url") and unmounted Settings. Validate + try/catch before
  // constructing URL in render — invalid shows fallback, never throws.
  const safePortfolioHostname = (input: string): string | null => {
    try {
      const normalized = normalizePortfolio(input)
      if (!normalized) return null
      return new URL(normalized).hostname
    } catch { return null }
  }
  const handleSavePortfolio = async () => {
    setPortfolioError(null)
    const raw = portfolioUrl.trim()
    if (!raw) {
      setPortfolioSaving(true)
      try { const res = await userAPI.updateProfile({ portfolioUrl: '' }); updateUser({ portfolioUrl: null } as any); toast.success('Portfolio link removed'); } catch (e:any) { toast.error(e?.response?.data?.error || 'Failed to remove') } finally { setPortfolioSaving(false) }
      return
    }
    const normalized = normalizePortfolio(raw)
    if (!normalized) { setPortfolioError('Enter a valid URL — e.g., https://your-portfolio.com'); return }
    setPortfolioSaving(true)
    try {
      const res = await userAPI.updateProfile({ portfolioUrl: normalized })
      setPortfolioUrl(res?.portfolioUrl || normalized)
      updateUser({ portfolioUrl: res?.portfolioUrl || normalized } as any)
      toast.success('Portfolio link saved — visible on your public profile!')
    } catch (e:any) { toast.error(e?.response?.data?.error || 'Failed to save portfolio'); setPortfolioError(e?.response?.data?.error || 'Failed to save') }
    finally { setPortfolioSaving(false) }
  }

  const sanitize = (v:string)=> v.toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,20)
  const checkUsername = async (val:string) => {
    const u = sanitize(val)
    if (!u || u.length<3) { setUsernameAvailable(null); return }
    if (!/^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u)) { setUsernameAvailable(false); return }
    setUsernameChecking(true)
    try {
      const r = await userAPI.checkUsername(u)
      setUsernameAvailable(r.available)
    } catch { setUsernameAvailable(null) }
    setUsernameChecking(false)
  }
  const handleSaveUsername = async () => {
    const u = sanitize(username)
    if (!/^[a-z0-9]([a-z0-9._-]{1,18}[a-z0-9])?$/.test(u)) { toast.error('3-20 chars, letters/numbers/_.-'); return }
    setUsernameSaving(true)
    try {
      const res = await userAPI.setUsername(u)
      updateUser({ username: res.username } as any)
      setUsername(res.username)
      toast.success(`Username @${res.username} saved`)
    } catch (e:any) { toast.error(e.response?.data?.error || 'Failed to save') }
    setUsernameSaving(false)
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) { toast.error('Fill all password fields'); return }
    if (newPassword.length < 6) { toast.error('New password must be at least 6 characters'); return }
    if (newPassword.length > 128) { toast.error('New password too long (max 128)'); return }
    if (newPassword !== confirmPassword) { toast.error('New passwords do not match'); return }
    if (currentPassword === newPassword) { toast.error('New password must be different from current'); return }
    setChangeSaving(true)
    try {
      await authAPI.changePassword({ currentPassword, newPassword })
      toast.success('Password changed successfully')
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (e:any) { toast.error(e.response?.data?.error || 'Failed to change password') }
    finally { setChangeSaving(false) }
  }

  const toggleNotification = (key: keyof typeof notifications) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // #12 self-delete — double confirm: password re-entry + typed DELETE.
  // Backend (DELETE /user/me) re-verifies password, anonymizes per
  // privacy.md §3, audit-logs without PII, and revokes the session.
  const handleDeleteMe = async () => {
    if (!deletePassword) { toast.error('Enter your password to confirm'); return }
    if (deleteConfirmText.trim() !== 'DELETE') { toast.error('Type DELETE to confirm'); return }
    setDeleting(true)
    try {
      await userAPI.deleteMe(deletePassword)
      toast.success(t('settings.deleteSuccess'))
      setDeletePassword(''); setDeleteConfirmText(''); setDeleteOpen(false)
      // Sync logout is fire-and-forget (no network await); navigate
      // deterministically with replace (no dashboard flash, no history entry).
      await logout()
      navigate(LOGOUT_DEST, { replace: true })
    } catch (e: any) {
      toast.error(e?.response?.data?.error || 'Failed to delete account')
    } finally { setDeleting(false) }
  }

  return (
    <div className="space-y-6 max-w-[840px] mx-auto">
      <h1 className="sr-only">Settings — Manage your profile and preferences</h1>
      {/* ─── Premium Hero — Brand mesh, glass stats ─── */}
      <PremiumHero
        icon={<Settings2 size={18} />}
        eyebrow="Account · Settings"
        title={<>Settings</>}
        subtitle="Manage your account preferences, security and integrations — everything in one premium bento."
        actions={
          <>
            <span className="inline-flex items-center gap-2 px-4 h-11 rounded-full bg-white text-black text-[13px] font-black shadow-lg">
              <Sparkles size={14} className="text-primary-600"/> {user?.role || 'Student'}
            </span>
            <span className="hidden sm:inline-flex items-center gap-2 px-4 h-11 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-white text-[13px] font-bold">
              <User size={14}/> {user?.name?.split(' ')[0] || 'Account'}
            </span>
            <span className="hidden sm:inline-flex items-center gap-2 px-4 h-11 rounded-full bg-primary-500 text-black text-[13px] font-black">
              <Shield size={14}/> Secure
            </span>
          </>
        }
        stats={
          <GlassPanel className="p-4">
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-white/60">Account Pulse</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white p-3 dark:bg-[#121212] border border-white/10">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/50 dark:text-white/60">Profile</p>
                <p className="mt-1 font-display text-[13px] font-[800] leading-none text-black dark:text-white truncate">{user?.name || '—'}</p>
                <p className="mt-1 text-[11px] font-semibold text-black/60 dark:text-white/60 truncate">@{username || (user as any)?.username || 'username'}</p>
              </div>
              <div className="rounded-2xl bg-primary-500 p-3 text-black">
                <p className="text-[10px] font-black tracking-widest uppercase text-black/60">Portfolio</p>
                <p className="mt-1 text-[11px] font-black leading-tight truncate">{portfolioUrl ? 'Linked ✓' : 'Not linked'}</p>
                <p className="mt-1 text-[11px] font-bold text-black/70 truncate">{portfolioUrl ? (safePortfolioHostname(portfolioUrl) ?? 'Invalid URL') : 'Add your site'}</p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur border border-white/10 p-3 col-span-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white/70 flex items-center gap-1"><Code size={11}/> Coding</span>
                  <span className="text-xs font-black text-white">{filledCount}/5 linked</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden flex">
                  <div className="bg-primary-500 transition-all" style={{ width: `${(filledCount/5)*100}%` }} />
                </div>
                <p className="mt-1 text-[11px] font-medium text-white/50">{codingProfile?.lastSyncedAt ? `Synced ${new Date(codingProfile.lastSyncedAt).toLocaleDateString()}` : 'Sync to update'}</p>
              </div>
            </div>
          </GlassPanel>
        }
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />

      {/* ─── Single-column premium bento — stagger ─── */}
      <motion.div initial="hidden" animate="show" variants={{ hidden:{}, show:{ transition:{ staggerChildren:0.07, delayChildren:0.1 } } }} className="space-y-6">
        {/* Profile — SectionCard premium */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <SectionCard title="Profile" subtitle={`${user?.role || 'Student'} · Public & private info`} icon={<User size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500" action={<span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-500 text-black text-[11px] font-black tracking-widest uppercase"><span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse"/> Live</span>}>
            <div className="flex flex-col md:flex-row gap-8">
              {/* Avatar */}
              <div className="flex flex-col items-center md:items-start gap-4 shrink-0">
                <div className="relative group">
                  <div className="w-28 h-28 rounded-[24px] bg-[#0a0a0a] dark:bg-white flex items-center justify-center text-white dark:text-black text-3xl font-black shadow-lg border border-surface-200 dark:border-[#282828]">
                    {user?.name?.charAt(0)?.toUpperCase() || 'A'}
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center border-2 border-white dark:border-[#121212]"><Camera size={14} className="text-black"/></div>
                </div>
                <p className="text-xs font-bold text-surface-500 dark:text-night-400 text-center md:text-left">Avatar · {user?.name?.split(' ')[0] || 'You'}</p>
              </div>

              {/* Fields */}
              <div className="flex-1 space-y-5 min-w-0">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">First Name</label>
                    <input
                      type="text"
                      defaultValue={user?.name?.split(' ')[0] || 'Alex'}
                      onChange={(e) => setProfile((p: any) => ({ ...p, firstName: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Last Name</label>
                    <input
                      type="text"
                      defaultValue={user?.name?.split(' ').slice(1).join(' ') || 'Johnson'}
                      onChange={(e) => setProfile((p: any) => ({ ...p, lastName: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Username — your public profile link</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 font-mono text-sm">@</span>
                      <input
                        type="text"
                        value={username}
                        onChange={(e)=>{ const v=sanitize(e.target.value); setUsername(v); checkUsername(v) }}
                        placeholder={user?.name?.toLowerCase().replace(/\s+/g,'_') || 'username'}
                        className="w-full pl-8 pr-10 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2">
                        {usernameChecking ? <Loader2 size={14} className="animate-spin text-surface-400"/> : usernameAvailable===true ? <CheckCircle size={14} className="text-primary-500"/> : usernameAvailable===false ? <span className="text-[#ff4b5c] text-xs font-black">✕</span> : null}
                      </span>
                    </div>
                    <button onClick={handleSaveUsername} disabled={usernameSaving || usernameChecking || !username || usernameAvailable===false}
                      className="px-4 h-[44px] bg-primary-500 hover:bg-[#1ed760] text-black rounded-full text-sm font-black disabled:opacity-50 flex items-center gap-1.5 shadow-[0_8px_24px_rgba(30,215,96,0.25)] shrink-0">
                      {usernameSaving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save
                    </button>
                  </div>
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-1">Profile at <span className="font-mono font-bold text-primary-600">/u/{username || 'username'}</span> · 3-20 chars</p>
                  {usernameAvailable===true && <p className="text-xs font-black text-primary-600">Available!</p>}
                  {usernameAvailable===false && <p className="text-xs font-black text-[#ff4b5c]">Not available</p>}
                </div>

                <div>
                  <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Portfolio — showcase on your public profile</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"><ExternalLink size={14}/></span>
                      <input
                        type="url"
                        value={portfolioUrl}
                        onChange={(e)=>{ setPortfolioUrl(e.target.value); if(portfolioError) setPortfolioError(null) }}
                        onKeyDown={(e)=>{ if(e.key==='Enter') handleSavePortfolio() }}
                        placeholder="https://your-portfolio.com"
                        className={`w-full pl-9 pr-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 transition-colors bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder-surface-400 ${portfolioError ? 'border-[#ff4b5c] focus:border-[#ff4b5c] focus:ring-[#ff4b5c]/20' : 'border-surface-200 dark:border-[#282828] focus:border-primary-500 focus:ring-primary-500/20'}`}
                      />
                    </div>
                    <button onClick={handleSavePortfolio} disabled={portfolioSaving}
                      className="px-4 h-[44px] bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full text-sm font-black disabled:opacity-50 flex items-center gap-1.5 shrink-0 hover:bg-black dark:hover:bg-zinc-100 transition-colors">
                      {portfolioSaving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save
                    </button>
                  </div>
                  {portfolioError && <p className="text-xs font-bold text-[#ff4b5c] mt-1">{portfolioError}</p>}
                  <p className="text-xs font-medium text-surface-500 mt-1">Shown at <span className="font-mono font-bold text-primary-600">/u/{username || (user as any)?.username || 'username'}</span> for recruiters.</p>
                  {portfolioUrl && normalizePortfolio(portfolioUrl) && (
                    <a href={normalizePortfolio(portfolioUrl)!} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:underline break-all"><ExternalLink size={12}/> {normalizePortfolio(portfolioUrl)}</a>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Email</label>
                  <div className="relative">
                    <input
                      type="email"
                      defaultValue={user?.email || 'alex@university.edu'}
                      disabled
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] text-surface-500 bg-surface-50 dark:bg-[#0a0a0a] dark:text-night-400 cursor-not-allowed text-sm pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400"><Lock size={16} /></span>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Phone</label>
                    <input
                      type="tel"
                      defaultValue={(user as any)?.phone || ''}
                      placeholder="Enter phone number"
                      onChange={(e) => setProfile((p: any) => ({ ...p, phone: e.target.value }))}
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white placeholder-surface-400 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Student ID</label>
                    <input
                      type="text"
                      defaultValue={user?.studentId || user?.empNumber || ''}
                      disabled
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] text-surface-500 bg-surface-50 dark:bg-[#0a0a0a] dark:text-night-400 cursor-not-allowed text-sm"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button onClick={handleSaveProfile} disabled={saving} className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-50 shadow-[0_8px_24px_rgba(30,215,96,0.25)]">
                    {saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16} />} Save Changes
                  </button>
                </div>
              </div>
            </div>
          </SectionCard>
        </motion.div>

        {/* Security — Change Password — premium */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <SectionCard title="Security · Change Password" subtitle="Update your password — 6–128 chars" icon={<Shield size={16}/>} gradient="from-primary-500 via-primary-500 to-emerald-500" action={<span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-[11px] font-black tracking-widest uppercase"><Lock size={11}/> Secure</span>}>
            <div className="grid gap-4">
              <div>
                <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Current Password</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"><Lock size={16}/></span>
                  <input type={showCurrent ? 'text' : 'password'} value={currentPassword} onChange={e=> setCurrentPassword(e.target.value)} placeholder="Enter current password" className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
                  <button onClick={()=> setShowCurrent(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] flex items-center justify-center text-surface-500 hover:text-primary-600 transition-colors">
                    {showCurrent ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">New Password</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"><KeyRound size={16}/></span>
                    <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e=> setNewPassword(e.target.value)} placeholder="New password" className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
                    <button onClick={()=> setShowNew(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] flex items-center justify-center text-surface-500 hover:text-primary-600">
                      {showNew ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">Confirm New Password</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"><Shield size={16}/></span>
                    <input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e=> setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
                    <button onClick={()=> setShowConfirm(v=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] flex items-center justify-center text-surface-500 hover:text-primary-600">
                      {showConfirm ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs font-medium text-surface-500 dark:text-night-400">Use 6+ characters, mix letters & numbers for strength.</p>
                <button onClick={handleChangePassword} disabled={changeSaving || !currentPassword || !newPassword || !confirmPassword} className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-sm font-black hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed shadow">
                  {changeSaving ? <Loader2 size={16} className="animate-spin"/> : <Lock size={16}/>} Update Password
                </button>
              </div>
            </div>
          </SectionCard>
        </motion.div>

        {/* Notifications — premium */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <SectionCard title="Notification Preferences" subtitle="Choose how you want to be notified" icon={<Bell size={16}/>} gradient="from-primary-500 to-emerald-500">
            <div className="space-y-3">
              {[
                { key:'email', label:'Email Notifications', sub:'Receive updates and alerts via email' },
                { key:'push', label:'Push Notifications', sub:'Get real-time notifications in your browser' },
                { key:'sms', label:'SMS Notifications', sub:'Receive important alerts via text message' },
              ].map(item=> (
                <div key={item.key} className="flex items-center justify-between p-4 rounded-2xl bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] hover:border-primary-500/20 transition-colors">
                  <div>
                    <p className="text-sm font-black text-[#0a0a0a] dark:text-white">{item.label}</p>
                    <p className="text-xs font-medium text-surface-500 dark:text-night-400">{item.sub}</p>
                  </div>
                  <button
                    onClick={() => toggleNotification(item.key as any)}
                    className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${notifications[item.key as keyof typeof notifications] ? 'bg-primary-500' : 'bg-surface-300 dark:bg-[#282828]'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${notifications[item.key as keyof typeof notifications] ? 'translate-x-6' : 'translate-x-0'}`} />
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>
        </motion.div>

        {/* Appearance — premium */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <SectionCard title="Appearance" subtitle="Customize how CampusFlow looks" icon={<Sun size={16}/>} gradient="from-primary-500 to-emerald-500">
            {/* #12 i18n — language switcher (en today, structure for additions) */}
            <div className="mb-5 flex items-center justify-between gap-3 p-4 rounded-2xl bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828]">
              <div>
                <p className="text-sm font-black text-[#0a0a0a] dark:text-white">{t('common.language')}</p>
                <p className="text-xs font-medium text-surface-500 dark:text-night-400">{t('settings.languageSub')}</p>
              </div>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                aria-label={t('common.language')}
                className="px-4 h-11 rounded-full border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] text-sm font-bold text-surface-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              >
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l} value={l}>{l === 'en' ? 'English' : l}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setTheme(value as typeof theme)}
                  className={`flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all ${theme === value ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10 shadow-sm' : 'border-surface-200 dark:border-[#282828] hover:border-surface-300 bg-white dark:bg-[#0a0a0a]'}`}
                >
                  <span className={`w-12 h-12 rounded-xl flex items-center justify-center ${theme === value ? 'bg-primary-500 text-black' : 'bg-surface-100 dark:bg-[#1a1a1a] text-surface-500 dark:text-night-400'}`}>
                    <Icon size={22} />
                  </span>
                  <span className={`text-sm font-black ${theme === value ? 'text-primary-600' : 'text-surface-700 dark:text-night-300'}`}>
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </SectionCard>
        </motion.div>

        {/* Coding Profiles — premium */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <SectionCard title="Coding Profiles" subtitle="Link your coding platform accounts" icon={<Code size={16}/>} gradient="from-primary-500 to-emerald-500" action={<span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-500 text-black text-xs font-black"><Zap size={11}/> {filledCount}/5</span>}>
            {codingLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin text-primary-500" size={24} />
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {codingPlatforms.map((p) => (
                    <div key={p.key} className="flex items-center gap-3 p-3 rounded-2xl bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] hover:border-primary-500/20 transition-colors">
                      <span className={`w-3 h-3 rounded-full ${p.color} shrink-0`} />
                      <label className="w-28 text-sm font-black text-[#0a0a0a] dark:text-white hidden sm:block">{p.label}</label>
                      <input
                        type="text"
                        value={codingHandles[p.key] || ''}
                        onChange={(e) => setCodingHandles({ ...codingHandles, [p.key]: e.target.value })}
                        placeholder={`Your ${p.label} handle`}
                        className="flex-1 px-3 py-2 rounded-xl border border-surface-200 dark:border-[#282828] bg-white dark:bg-[#121212] text-sm text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                      />
                      {codingHandles[p.key] && (
                        <a href={`${p.url}${codingHandles[p.key]}`} target="_blank" rel="noopener noreferrer"
                          className="p-2 rounded-xl bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-surface-500 hover:text-primary-600 hover:border-primary-500/20 transition-colors">
                          <ExternalLink size={14} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3 mt-5">
                  <button onClick={handleSaveCoding} disabled={codingSaving} className="inline-flex items-center gap-2 px-5 h-11 rounded-full bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] disabled:opacity-50 shadow-[0_8px_24px_rgba(30,215,96,0.25)]">
                    {codingSaving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14} />} Save Profiles
                  </button>
                  <button 
                    onClick={handleSyncCoding} 
                    disabled={syncing || filledCount === 0}
                    className="px-5 h-11 bg-[#0a0a0a] dark:bg-white text-white dark:text-black rounded-full text-sm font-black hover:bg-black dark:hover:bg-zinc-100 disabled:opacity-50 flex items-center gap-2 transition-colors"
                  >
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Sync Now
                  </button>
                </div>

                {codingProfile?.lastSyncedAt && (
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400 mt-3">
                    Last synced: {new Date(codingProfile.lastSyncedAt).toLocaleString()}
                  </p>
                )}

                {participations.length > 0 && (
                  <div className="mt-5 pt-5 border-t border-surface-200 dark:border-[#282828]">
                    <h3 className="text-sm font-black text-[#0a0a0a] dark:text-white mb-3">Contest History ({participations.length})</h3>
                    <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                      {participations.slice(0, 10).map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-3 bg-surface-50 dark:bg-[#0a0a0a] border border-surface-200 dark:border-[#282828] rounded-2xl">
                          <div>
                            <p className="text-sm font-black text-[#0a0a0a] dark:text-white">{p.contestName}</p>
                            <p className="text-xs font-medium text-surface-500">{p.platform} {p.participatedAt ? `• ${new Date(p.participatedAt).toLocaleDateString()}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-3 text-sm">
                            {p.rank && <span className="text-xs font-bold px-2 py-1 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black">#{p.rank}</span>}
                            {p.rating && <span className="font-black text-primary-600">{p.rating}</span>}
                            {p.ratingChange && (
                              <span className={clsx('text-xs font-black px-1.5 py-0.5 rounded-full', p.ratingChange > 0 ? 'bg-primary-500 text-black' : 'bg-[#ff4b5c] text-white')}>
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
          </SectionCard>
        </motion.div>

        {/* #12 Danger Zone — self-delete with double confirm (password + DELETE) */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-[#ff4b5c]/30 dark:border-[#ff4b5c]/20 overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-[#ff4b5c] to-[#ff8a5c]" />
            <div className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-[#ff4b5c]/10 border border-[#ff4b5c]/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-[#ff4b5c]" />
                  </span>
                  <div>
                    <h3 className="font-black text-[#0a0a0a] dark:text-white">{t('settings.dangerZone')}</h3>
                    <p className="text-xs font-medium text-surface-500 dark:text-night-400">{t('settings.dangerZoneSub')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDeleteOpen(v => !v)}
                  aria-expanded={deleteOpen}
                  className="px-6 h-11 rounded-full border-2 border-[#ff4b5c] text-[#ff4b5c] text-sm font-black hover:bg-[#ff4b5c] hover:text-white transition-colors shrink-0"
                >
                  {t('settings.deleteAccount')}
                </button>
              </div>
              {deleteOpen && (
                <div className="mt-5 pt-5 border-t border-surface-200 dark:border-[#282828] space-y-4">
                  <p className="text-sm font-medium text-surface-600 dark:text-night-300">{t('settings.deleteConfirmBody')}</p>
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">{t('settings.deleteStepPassword')}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400"><Lock size={16}/></span>
                      <input
                        type={showDeletePassword ? 'text' : 'password'}
                        value={deletePassword}
                        onChange={e => setDeletePassword(e.target.value)}
                        placeholder={t('auth.currentPassword')}
                        autoComplete="current-password"
                        className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4b5c]/20 focus:border-[#ff4b5c]"
                      />
                      <button onClick={() => setShowDeletePassword(v => !v)} aria-label="Toggle password visibility" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] flex items-center justify-center text-surface-500 hover:text-[#ff4b5c] transition-colors">
                        {showDeletePassword ? <EyeOff size={14}/> : <Eye size={14}/>}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-black tracking-widest uppercase text-surface-500 dark:text-night-400 mb-1.5">{t('settings.deleteStepType')}</label>
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={e => setDeleteConfirmText(e.target.value)}
                      placeholder={t('settings.deleteTypePlaceholder')}
                      autoComplete="off"
                      className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-[#282828] bg-surface-50 dark:bg-[#0a0a0a] text-surface-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#ff4b5c]/20 focus:border-[#ff4b5c]"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <button onClick={() => { setDeleteOpen(false); setDeletePassword(''); setDeleteConfirmText('') }} className="px-5 h-11 rounded-full border border-surface-200 dark:border-[#282828] text-sm font-bold text-surface-600 dark:text-night-300 hover:bg-surface-50 dark:hover:bg-[#1a1a1a] transition-colors">
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleDeleteMe}
                      disabled={deleting || !deletePassword || deleteConfirmText.trim() !== 'DELETE'}
                      className="inline-flex items-center gap-2 px-6 h-11 rounded-full bg-[#ff4b5c] text-white text-sm font-black hover:bg-[#e53e4c] disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_8px_24px_rgba(255,75,92,0.3)]"
                    >
                      {deleting ? <Loader2 size={16} className="animate-spin"/> : null} {t('settings.deleteCta')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Sign Out — premium danger but Brand style */}
        <motion.div variants={{ hidden:{opacity:0,y:14}, show:{opacity:1,y:0, transition:{ duration:0.45, ease:[0.22,1,0.36,1] as any } } }}>
          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-[#ff4b5c] to-[#ff4b5c]" />
            <div className="p-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-[#ff4b5c]/10 border border-[#ff4b5c]/20 flex items-center justify-center">
                  <LogOut className="w-5 h-5 text-[#ff4b5c]" />
                </span>
                <div>
                  <h3 className="font-black text-[#0a0a0a] dark:text-white">Sign Out</h3>
                  <p className="text-xs font-medium text-surface-500 dark:text-night-400">Sign out from all devices</p>
                </div>
              </div>
              <button onClick={() => { logout(); navigate(LOGOUT_DEST, { replace: true }) }} className="px-6 h-11 rounded-full bg-[#ff4b5c] text-white text-sm font-black hover:bg-[#e53e4c] shadow-[0_8px_24px_rgba(255,75,92,0.3)]">Sign Out</button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { codingProfileAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { motion } from 'framer-motion'
import { Code, Loader2, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const platforms = [
  { key: 'leetcodeHandle', label: 'LeetCode', color: 'bg-yellow-500', url: 'https://leetcode.com/' },
  { key: 'codeforcesHandle', label: 'Codeforces', color: 'bg-blue-500', url: 'https://codeforces.com/profile/' },
  { key: 'codechefHandle', label: 'CodeChef', color: 'bg-amber-600', url: 'https://www.codechef.com/users/' },
  { key: 'hackerrankHandle', label: 'HackerRank', color: 'bg-green-600', url: 'https://www.hackerrank.com/' },
  { key: 'gfgHandle', label: 'GeeksforGeeks', color: 'bg-emerald-600', url: 'https://www.geeksforgeeks.org/user/' },
]

export default function CodingProfilePage() {
  const { user } = useAuthStore()
  const [profile, setProfile] = useState<any>(null)
  const [handles, setHandles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [participations, setParticipations] = useState<any[]>([])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [profileData, partData] = await Promise.all([
        codingProfileAPI.get(),
        codingProfileAPI.getParticipations(),
      ])
      setProfile(profileData)
      setHandles({
        leetcodeHandle: profileData?.leetcodeHandle || '',
        codeforcesHandle: profileData?.codeforcesHandle || '',
        codechefHandle: profileData?.codechefHandle || '',
        hackerrankHandle: profileData?.hackerrankHandle || '',
        gfgHandle: profileData?.gfgHandle || '',
      })
      setParticipations(partData)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await codingProfileAPI.update(handles)
      toast.success('Profiles saved!')
      loadData()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await codingProfileAPI.sync()
      toast.success(`Synced ${result.synced} records from ${result.platforms.join(', ') || 'none'}`)
      loadData()
    } catch {
      toast.error('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const filledCount = Object.values(handles).filter(Boolean).length

  if (loading) return <div className="flex items-center justify-center h-96"><Loader2 className="animate-spin text-primary-500" size={32} /></div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl text-white">
            <Code size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900">Coding Profile</h1>
            <p className="text-surface-500 text-sm">Link your coding platform accounts to track contest participation</p>
          </div>
        </div>

        {/* Platform Handles */}
        <div className="bg-white rounded-2xl border border-surface-100 p-6 mb-6">
          <h2 className="font-bold text-surface-900 mb-4">Platform Handles</h2>
          <div className="space-y-3">
            {platforms.map((p) => (
              <div key={p.key} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${p.color}`} />
                <label className="w-32 text-sm font-medium text-surface-700">{p.label}</label>
                <input
                  type="text"
                  value={handles[p.key] || ''}
                  onChange={(e) => setHandles({ ...handles, [p.key]: e.target.value })}
                  placeholder={`Your ${p.label} handle`}
                  className="flex-1 px-3 py-2 border border-surface-200 rounded-xl text-sm"
                />
                {handles[p.key] && (
                  <a href={`${p.url}${handles[p.key]}`} target="_blank" rel="noopener noreferrer"
                    className="p-2 text-surface-400 hover:text-primary-500">
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button onClick={handleSave} disabled={saving}
              className="px-6 py-2.5 bg-gradient-to-r from-primary-500 to-accent-500 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              Save Profiles
            </button>
            <button onClick={handleSync} disabled={syncing || filledCount === 0}
              className="px-6 py-2.5 bg-surface-100 text-surface-700 rounded-xl font-medium hover:bg-surface-200 disabled:opacity-50 flex items-center gap-2">
              {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Sync Now
            </button>
          </div>

          {profile?.lastSyncedAt && (
            <p className="text-xs text-surface-400 mt-3">
              Last synced: {new Date(profile.lastSyncedAt).toLocaleString()}
            </p>
          )}
        </div>

        {/* Participations */}
        <div className="bg-white rounded-2xl border border-surface-100 p-6">
          <h2 className="font-bold text-surface-900 mb-4">Contest History ({participations.length})</h2>
          {participations.length === 0 ? (
            <p className="text-surface-400 text-sm">No contest data yet. Add handles and click Sync.</p>
          ) : (
            <div className="space-y-2">
              {participations.slice(0, 20).map((p) => (
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
          )}
        </div>
      </motion.div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { codingProfileAPI } from '../lib/api'
import { ArrowLeft, Trophy, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

function exportToCSV(data: any[], filename: string, headers: string[]) {
  const csvRows = [headers.join(',')]
  for (const row of data) {
    csvRows.push(headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','))
  }
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ContestLeaderboardPage() {
  const navigate = useNavigate()
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    codingProfileAPI.getLeaderboard()
      .then(setLeaderboard)
      .catch(() => toast.error('Failed to load leaderboard'))
      .finally(() => setLoading(false))
  }, [])

  const handleExport = () => {
    if (leaderboard.length === 0) {
      toast.error('No data to export')
      return
    }
    exportToCSV(
      leaderboard.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        department: e.department,
        contests: e.totalContests,
        bestRating: e.bestRating,
      })),
      'leaderboard.csv',
      ['rank', 'name', 'department', 'contests', 'bestRating']
    )
    toast.success('Leaderboard exported')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/contests')}
            className="p-2 rounded-lg hover:bg-surface-100 transition-colors"
          >
            <ArrowLeft size={20} className="text-surface-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-2">
              <Trophy size={24} className="text-yellow-500" />
              Contest Leaderboard
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">Top performers across all contests</p>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-xl hover:shadow-lg transition-all text-sm font-medium"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Leaderboard Table */}
      {leaderboard.length === 0 ? (
        <div className="bg-white rounded-2xl border border-surface-100 p-12 text-center">
          <Trophy size={48} className="mx-auto text-surface-300 mb-4" />
          <p className="text-surface-500 font-medium">No leaderboard data yet</p>
          <p className="text-sm text-surface-400 mt-1">Participants will appear here after contests</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-surface-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Rank</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-surface-500 uppercase tracking-wider">Department</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-surface-500 uppercase tracking-wider">Contests</th>
                  <th className="px-6 py-4 text-center text-xs font-semibold text-surface-500 uppercase tracking-wider">Best Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50">
                {leaderboard.map((entry, idx) => (
                  <tr key={entry.userId} className="hover:bg-surface-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                        idx === 1 ? 'bg-gray-100 text-gray-700' :
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-surface-100 text-surface-600'
                      }`}>
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-medium text-surface-900">{entry.name}</td>
                    <td className="px-6 py-4 text-surface-500">{entry.department}</td>
                    <td className="px-6 py-4 text-center font-semibold text-surface-900">{entry.totalContests}</td>
                    <td className="px-6 py-4 text-center font-bold text-primary-600">{entry.bestRating}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

import { BarChart3, CheckCircle, Clock, AlertCircle } from 'lucide-react'

interface FetchStatsProps {
  totalFetched: number
  totalEnriched: number
  totalPending: number
}

export default function FetchStats({ totalFetched, totalEnriched, totalPending }: FetchStatsProps) {
  const enrichedPercent = totalFetched > 0 ? Math.round((totalEnriched / totalFetched) * 100) : 0

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-100 rounded-lg">
            <BarChart3 className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{totalFetched}</p>
            <p className="text-sm text-surface-500">Total Fetched</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{totalEnriched}</p>
            <p className="text-sm text-surface-500">Enriched ({enrichedPercent}%)</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Clock className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-600">{totalPending}</p>
            <p className="text-sm text-surface-500">Pending</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-surface-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-100 rounded-lg">
            <AlertCircle className="w-5 h-5 text-surface-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{100 - enrichedPercent}%</p>
            <p className="text-sm text-surface-500">Needs Work</p>
          </div>
        </div>
      </div>
    </div>
  )
}

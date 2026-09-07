import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { codingProfileAPI, departmentAPI } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { ArrowLeft, Trophy, Download, Medal, Search, Filter, Users, BarChart3, TrendingUp, GraduationCap, BookOpen, Star } from 'lucide-react'
import toast from 'react-hot-toast'
import Pagination from '../components/shared/Pagination'
import { PremiumHero, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'
import CenteredLoader from '../components/ui/CenteredLoader'
import clsx from 'clsx'

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
  const { user } = useAuthStore()
  const isTeacher = user?.role === 'TEACHER' || user?.role === 'COLLEGE_ADMIN' || user?.role === 'SUPER_ADMIN'
  const [leaderboard, setLeaderboard] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selectedDept, setSelectedDept] = useState('ALL')
  const [selectedYear, setSelectedYear] = useState('ALL')
  const [departments, setDepartments] = useState<any[]>([])

  useEffect(() => {
    codingProfileAPI.getLeaderboard()
      .then(setLeaderboard)
      .catch(() => toast.error('Failed to load leaderboard'))
      .finally(() => setLoading(false))
    departmentAPI.getAll().then(setDepartments).catch(()=>{})
  }, [])

  // ── Derived analytics (keep stats + success like hackathon/internship) ──
  const totalParticipants = leaderboard.length
  const totalContestsSum = useMemo(() => leaderboard.reduce((a,b)=> a + (b.totalContests||0), 0), [leaderboard])
  const avgContests = totalParticipants ? (totalContestsSum/totalParticipants).toFixed(1) : '0'
  const topRating = useMemo(() => Math.max(0, ...leaderboard.map(l=> l.bestRating||0)), [leaderboard])
  const topCoder = useMemo(() => leaderboard.length ? [...leaderboard].sort((a,b)=> b.bestRating - a.bestRating)[0] : null, [leaderboard])
  const deptBreakdown = useMemo(() => {
    const m=new Map<string, number>()
    leaderboard.forEach(e=>{ const k=e.department||'Unknown'; m.set(k,(m.get(k)||0)+1) })
    return Array.from(m.entries()).sort((a,b)=>b[1]-a[1])
  }, [leaderboard])
  const availableYears = useMemo(() => {
    const s=new Set<string>()
    leaderboard.forEach(e=>{ if(e.incomingYear) s.add(String(e.incomingYear)) })
    return Array.from(s).sort()
  }, [leaderboard])

  const filtered = useMemo(() => {
    const term=search.trim().toLowerCase()
    return leaderboard.filter(e=>{
      if(term){
        const hay=`${e.name||''} ${e.department||''}`.toLowerCase()
        if(!hay.includes(term)) return false
      }
      if(selectedDept!=='ALL'){
        // departmentId if present else name match
        if(e.departmentId){
          if(e.departmentId!==selectedDept) return false
        } else {
          const deptObj=departments.find(d=>d.id===selectedDept)
          const deptName=deptObj?.name
          if(deptName){
            if((e.department||'').toLowerCase()!==deptName.toLowerCase()) return false
          } else if(e.department!==selectedDept) return false
        }
      }
      if(selectedYear!=='ALL'){
        if(String(e.incomingYear??'')!==selectedYear) return false
      }
      return true
    })
  }, [leaderboard, search, selectedDept, selectedYear, departments])

  // pagination on filtered
  const PAGE_SIZE = 20
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedLeaderboard = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  useEffect(()=>{ setPage(1) }, [search, selectedDept, selectedYear])

  const handleExport = () => {
    const data = filtered.length ? filtered : leaderboard
    if (data.length === 0) {
      toast.error('No data to export')
      return
    }
    exportToCSV(
      data.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        department: e.department,
        year: e.incomingYear ?? '',
        contests: e.totalContests,
        bestRating: e.bestRating,
        avgRank: e.avgRank ?? '',
      })),
      'leaderboard.csv',
      ['rank', 'name', 'department', 'year', 'contests', 'bestRating', 'avgRank']
    )
    toast.success(`Exported ${data.length} rows`)
  }

  const handleExportXlsxFiltered = () => {
    // CSV is primary; XLSX would need backend — keep CSV but also allow filtered export via same handler
    handleExport()
  }

  if (loading) {
    return <CenteredLoader text="Loading leaderboard..." />
  }

  return (
    <div className="space-y-6 max-w-[1280px] mx-auto">
      <PremiumHero
        icon={<Medal size={18} />}
        eyebrow="Coding · Leaderboard"
        title={<>Leaderboard</>}
        subtitle="Top coders — ratings, streaks and college rankings. Filter by department & year, export ready."
      />
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/contests')}
            className="p-2 rounded-xl bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] hover:bg-surface-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            <ArrowLeft size={18} className="text-surface-700 dark:text-white" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white flex items-center gap-2">
              <Trophy size={22} className="text-amber-500" />
              Contest Leaderboard
            </h1>
            <p className="text-sm text-surface-500 dark:text-zinc-400 mt-0.5">Top performers across all contests</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 h-10 rounded-full bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-[#282828] text-surface-700 dark:text-white text-sm font-black hover:border-primary-500/30 transition-colors"
          >
            <Download size={16} /> Export CSV
          </button>
          {isTeacher && (
            <button
              onClick={handleExportXlsxFiltered}
              className="hidden sm:inline-flex items-center gap-2 px-4 h-10 rounded-full bg-primary-500 text-black text-sm font-black hover:bg-[#1ed760] shadow"
            >
              <Download size={16} /> Export
            </button>
          )}
        </div>
      </div>

      {/* Analytics — keep stats like hackathon registrations: total, avg, top rating, dept breakdown */}
      <BentoGrid>
        <BentoCard span="col-span-12 md:col-span-3" className="p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center shrink-0"><Users size={16}/></span>
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-zinc-500">Participants</p>
          </div>
          <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{totalParticipants}</p>
          <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-zinc-400">{totalContestsSum} total contests</p>
          <div className="mt-3 h-1.5 rounded-full bg-surface-100 dark:bg-white/10 overflow-hidden flex"><div className="bg-primary-500" style={{ width: `${totalParticipants?100:0}%` }}/></div>
        </BentoCard>
        <BentoCard span="col-span-12 md:col-span-3" className="p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center shrink-0"><BarChart3 size={16}/></span>
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-zinc-500">Avg Contests</p>
          </div>
          <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{avgContests}</p>
          <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-zinc-400">Per participant</p>
          <div className="mt-3 h-1.5 rounded-full bg-surface-100 dark:bg-white/10 overflow-hidden"><div className="h-full bg-[#0a0a0a] dark:bg-white" style={{ width: `${Math.min(100, Number(avgContests)*10)}%` }}/></div>
        </BentoCard>
        <BentoCard span="col-span-12 md:col-span-3" className="p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"><Star size={16}/></span>
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-zinc-500">Top Rating</p>
          </div>
          <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{topRating || '—'}</p>
          <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-zinc-400 truncate">{topCoder?.name || 'No data'} {topCoder?.department ? `· ${topCoder.department}` : ''}</p>
          <p className="mt-1 text-[10px] font-black tracking-wide uppercase text-amber-600 dark:text-amber-400 flex items-center gap-1"><TrendingUp size={10}/> Live ranking</p>
        </BentoCard>
        <BentoCard span="col-span-12 md:col-span-3" className="p-5">
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0"><GraduationCap size={16}/></span>
            <p className="text-[10px] font-black tracking-[0.12em] uppercase text-surface-400 dark:text-zinc-500">Departments</p>
          </div>
          <p className="font-display text-[28px] font-[800] leading-none text-surface-900 dark:text-white">{deptBreakdown.length}</p>
          <p className="mt-1 text-[11px] font-bold text-surface-500 dark:text-zinc-400">{deptBreakdown.slice(0,2).map(d=>`${d[0]} ${d[1]}`).join(' · ') || 'No breakdown'}</p>
          <div className="mt-2 max-h-[32px] overflow-hidden flex flex-wrap gap-1">
            {deptBreakdown.slice(0,3).map(([dept])=> <span key={dept} className="px-2 py-0.5 rounded-full bg-surface-50 dark:bg-white/[0.06] border border-surface-200 dark:border-white/10 text-[10px] font-bold text-surface-600 dark:text-zinc-300">{dept}</span>)}
          </div>
        </BentoCard>
      </BentoGrid>

      {/* Dept breakdown + Filters — keep dept/year filters like AssignmentDetail */}
      <BentoGrid>
        <BentoCard span="col-span-12 md:col-span-6" className="p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-9 h-9 rounded-xl bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center"><GraduationCap size={16}/></span>
            <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">By Department</h4>
            <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-surface-900 dark:bg-white text-white dark:text-black">{deptBreakdown.length} depts</span>
          </div>
          {deptBreakdown.length===0 ? <p className="text-xs text-surface-400 dark:text-zinc-500 py-6 text-center border border-dashed rounded-2xl dark:border-white/10">No data</p> : (
            <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
              {deptBreakdown.map(([dept,cnt])=> (
                <div key={dept} className="flex items-center justify-between text-xs bg-surface-50 dark:bg-white/[0.04] rounded-xl px-3 py-2 border border-surface-100 dark:border-white/10">
                  <span className="truncate font-semibold text-surface-700 dark:text-zinc-200">{dept}</span>
                  <span className="font-black px-1.5 py-0.5 rounded-full bg-primary-500 text-black text-[11px]">{cnt}</span>
                </div>
              ))}
            </div>
          )}
        </BentoCard>
        <BentoCard span="col-span-12 md:col-span-6" className="p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-9 h-9 rounded-xl bg-primary-500 text-black flex items-center justify-center"><BookOpen size={16}/></span>
            <h4 className="font-display text-[15px] font-[800] tracking-[-0.02em] text-[#0a0a0a] dark:text-white">By Year</h4>
            <span className="ml-auto text-xs font-black px-2.5 py-1 rounded-full bg-primary-500 text-black">{availableYears.length || 0} cohorts</span>
          </div>
          {availableYears.length===0 ? (
            <div className="space-y-1.5">
              <p className="text-xs text-surface-400 dark:text-zinc-500 py-2">Year data appears when profiles have incomingYear</p>
              <div className="flex flex-wrap gap-1.5">
                {[1,2,3,4].map(y=> <span key={y} className="px-2.5 py-1 rounded-full bg-surface-50 dark:bg-white/[0.04] border border-surface-200 dark:border-white/10 text-xs font-bold text-surface-600 dark:text-zinc-300">Year {y}</span>)}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
              {availableYears.map(y=>{
                const cnt = filtered.filter(f=> String(f.incomingYear)===y).length || leaderboard.filter(l=> String(l.incomingYear)===y).length
                return <div key={y} className="flex items-center justify-between text-xs bg-surface-50 dark:bg-white/[0.04] rounded-xl px-3 py-2 border border-surface-100 dark:border-white/10">
                  <span className="font-semibold text-surface-700 dark:text-zinc-200">Year {y}</span>
                  <span className="font-black px-1.5 py-0.5 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-[11px]">{cnt}</span>
                </div>
              })}
            </div>
          )}
        </BentoCard>
      </BentoGrid>

      {/* Filters & Export — dept + year kept */}
      <SectionCard title="Filters & Export" subtitle={`Showing ${filtered.length}/${totalParticipants} · Dept & Year filters + search`} icon={<Filter size={16}/>} gradient="from-primary-500 via-primary-600 to-emerald-500" action={
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-white dark:bg-[#1a1a1a] border border-surface-200 dark:border-white/10 text-surface-700 dark:text-white text-xs font-black hover:border-primary-500/30 transition-colors">
            <Download size={14}/> Export CSV
          </button>
          <button onClick={handleExportXlsxFiltered} className="hidden sm:inline-flex items-center gap-1.5 px-4 h-9 rounded-full bg-primary-500 text-black text-xs font-black hover:bg-[#1ed760] shadow">
            <Download size={14}/> Export XLSX
          </button>
        </div>
      }>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-zinc-500" />
            <input value={search} onChange={e=> setSearch(e.target.value)} placeholder="Search name, department..." className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-surface-50 dark:bg-[#0a0a0a] text-sm text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500" />
          </div>
          <select value={selectedDept} onChange={e=> setSelectedDept(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 min-w-[160px]">
            <option value="ALL">All departments</option>
            {departments.map((d:any)=> <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={selectedYear} onChange={e=> setSelectedYear(e.target.value)} className="px-3 py-2.5 rounded-xl border border-surface-200 dark:border-white/10 bg-white dark:bg-[#0a0a0a] text-surface-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
            <option value="ALL">All years</option>
            {[1,2,3,4].map(y=> <option key={y} value={y}>Year {y}</option>)}
            {availableYears.filter(y=>!['1','2','3','4'].includes(y)).map(y=> <option key={y} value={y}>Year {y}</option>)}
          </select>
        </div>
        {(selectedDept!=='ALL' || selectedYear!=='ALL' || search) && <button onClick={()=>{setSearch(''); setSelectedDept('ALL'); setSelectedYear('ALL')}} className="mt-3 text-xs font-bold text-primary-600 hover:text-primary-700 dark:text-primary-400 underline">Clear filters →</button>}
      </SectionCard>

      {/* Leaderboard Table */}
      {filtered.length === 0 ? (
        leaderboard.length === 0 ? (
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] p-12 text-center">
            <Trophy size={40} className="mx-auto text-surface-300 dark:text-zinc-600 mb-3" />
            <p className="text-surface-600 dark:text-zinc-300 font-bold">No leaderboard data yet</p>
            <p className="text-sm text-surface-400 dark:text-zinc-500 mt-1">Participants will appear here after contests</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] p-12 text-center">
            <Filter size={28} className="mx-auto text-surface-300 dark:text-zinc-600 mb-2" />
            <p className="text-surface-600 dark:text-zinc-300 font-bold">No matches</p>
            <p className="text-sm text-surface-400 dark:text-zinc-500 mt-1">Try clearing department / year / search filters</p>
            <button onClick={()=>{setSearch(''); setSelectedDept('ALL'); setSelectedYear('ALL')}} className="mt-4 px-5 h-10 rounded-full bg-primary-500 text-black text-sm font-black">Clear filters</button>
          </div>
        )
      ) : (
        <div className="bg-white dark:bg-[#121212] rounded-[24px] border border-surface-200 dark:border-[#282828] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-100 dark:border-white/10">
                  <th className="px-6 py-4 text-left text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Rank</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Name</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Department</th>
                  <th className="px-6 py-4 text-left text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Year</th>
                  <th className="px-6 py-4 text-center text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Contests</th>
                  <th className="px-6 py-4 text-center text-[11px] font-black tracking-widest uppercase text-surface-500 dark:text-zinc-400">Best Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-50 dark:divide-white/5">
                {pagedLeaderboard.map((entry, idx) => {
                  const rank = (page - 1) * PAGE_SIZE + idx + 1
                  return (
                  <tr key={entry.userId} className="hover:bg-surface-50 dark:hover:bg-white/[0.03] transition-colors">
                    <td className="px-6 py-4">
                      <span className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-sm font-black border',
                        rank === 1 ? 'bg-amber-500 text-white border-amber-500 shadow' :
                        rank === 2 ? 'bg-zinc-800 text-white border-zinc-800 dark:bg-zinc-700' :
                        rank === 3 ? 'bg-amber-700 text-white border-amber-700' :
                        'bg-surface-50 dark:bg-white/5 text-surface-700 dark:text-zinc-300 border-surface-200 dark:border-white/10'
                      )}>
                        {rank}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black flex items-center justify-center text-xs font-black shrink-0">
                          {entry.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <span className="font-[700] text-surface-900 dark:text-white text-sm">{entry.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-full bg-surface-50 dark:bg-white/5 border border-surface-200 dark:border-white/10 text-xs font-bold text-surface-700 dark:text-zinc-300">{entry.department || '—'}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-[#0a0a0a] dark:bg-white text-white dark:text-black text-xs font-black">{entry.incomingYear ? `Year ${entry.incomingYear}` : '—'}</span>
                    </td>
                    <td className="px-6 py-4 text-center font-[800] text-surface-900 dark:text-white">{entry.totalContests}</td>
                    <td className="px-6 py-4 text-center font-black text-primary-600 dark:text-primary-400">{entry.bestRating || '—'}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      )}
    </div>
  )
}

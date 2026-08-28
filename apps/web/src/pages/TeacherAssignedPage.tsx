import { useState, useEffect, useMemo } from 'react'
import { useAuthStore } from '../store/authStore'
import { hackathonAPI, internshipAPI } from '../lib/api'
import { motion } from 'framer-motion'
import {
  Trophy, Briefcase, CheckCircle2, XCircle, Clock,
  ExternalLink, Calendar, Building2, IndianRupee, Filter,
  Loader2, AlertCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import PageHeader from '../components/shared/PageHeader'
import EmptyState from '../components/shared/EmptyState'
import { parseJsonArray, parseJsonNumberArray } from '../lib/parseJson'

export default function TeacherAssignedPage() {
  const { user } = useAuthStore()
  const [hackathons, setHackathons] = useState<any[]>([])
  const [internships, setInternships] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<'all' | 'HACKATHON' | 'INTERNSHIP'>('all')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [hackData, intData] = await Promise.all([
        hackathonAPI.getStaging(),
        internshipAPI.getStaging(),
      ])
      // Filter to only items assigned to this teacher
      setHackathons(hackData.filter((h: any) => h.assignedTeacherId === user?.id))
      setInternships(intData.filter((i: any) => i.assignedTeacherId === user?.id))
    } catch (err) {
      console.error('Failed to load', err)
    } finally {
      setLoading(false)
    }
  }

  const allItems = useMemo(() => {
    const items = [
      ...hackathons.map((h) => ({ ...h, _type: 'HACKATHON' as const })),
      ...internships.map((i) => ({ ...i, _type: 'INTERNSHIP' as const })),
    ]
    return typeFilter === 'all' ? items : items.filter((i) => i._type === typeFilter)
  }, [hackathons, internships, typeFilter])

  const handleApprove = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    if (!confirm('Approve this opportunity?')) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.approveStaging(id)
        setHackathons((prev) => prev.filter((h) => h.id !== id))
      } else {
        await internshipAPI.approveStaging(id)
        setInternships((prev) => prev.filter((i) => i.id !== id))
      }
      toast.success('Approved! Students can now see this.')
    } catch (err) {
      toast.error('Failed to approve')
    }
  }

  const handleReject = async (id: string, type: 'HACKATHON' | 'INTERNSHIP') => {
    if (!confirm('Reject this opportunity?')) return
    try {
      if (type === 'HACKATHON') {
        await hackathonAPI.deleteStaging(id)
        setHackathons((prev) => prev.filter((h) => h.id !== id))
      } else {
        await internshipAPI.deleteStaging(id)
        setInternships((prev) => prev.filter((i) => i.id !== id))
      }
      toast.success('Rejected')
    } catch (err) {
      toast.error('Failed to reject')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-50 to-primary-50/30 dark:from-night-950 dark:via-night-950 dark:to-night-950">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-50 to-primary-50/30 dark:from-night-950 dark:via-night-950 dark:to-night-950">
      <PageHeader
        title="Assigned to Me"
        subtitle="Review and approve/reject opportunities assigned to you"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Type Filter */}
        <div className="flex items-center gap-2 mb-6">
          <Filter size={16} className="text-surface-500" />
          <span className="text-sm font-medium text-surface-700">Type:</span>
          <div className="flex gap-1.5">
            {(['all', 'HACKATHON', 'INTERNSHIP'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTypeFilter(filter)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                  typeFilter === filter
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                )}
              >
                {filter === 'all' ? 'All' : filter === 'HACKATHON' ? 'Hackathons' : 'Internships'}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl border border-surface-100 p-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                <CheckCircle2 size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{allItems.length}</p>
                <p className="text-xs text-surface-500">Total Assigned</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl border border-surface-100 p-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-warning-100 flex items-center justify-center">
                <Trophy size={20} className="text-warning-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{hackathons.length}</p>
                <p className="text-xs text-surface-500">Hackathons</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl border border-surface-100 p-5"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
                <Briefcase size={20} className="text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-900">{internships.length}</p>
                <p className="text-xs text-surface-500">Internships</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Cards */}
        {allItems.length === 0 ? (
          <EmptyState
            icon={AlertCircle}
            title="No opportunities assigned"
            description="There are no hackathons or internships assigned to you for review."
          />
        ) : (
          <div className="space-y-4">
            {allItems.map((item, i) => {
              const themes = parseJsonArray(item.themes)
              const depts = parseJsonArray(item.targetDepartments)
              const years = parseJsonNumberArray(item.targetYears)

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="bg-white rounded-2xl border border-surface-100 p-5 hover:border-surface-200 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {/* Top row: type badge & source */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span
                          className={clsx(
                            'px-2.5 py-1 rounded-full text-xs font-semibold',
                            item._type === 'HACKATHON'
                              ? 'bg-warning-100 text-warning-700'
                              : 'bg-primary-100 text-primary-700'
                          )}
                        >
                          {item._type === 'HACKATHON' ? (
                            <span className="flex items-center gap-1">
                              <Trophy size={10} />
                              HACKATHON
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Briefcase size={10} />
                              INTERNSHIP
                            </span>
                          )}
                        </span>
                        {item.source && (
                          <span className="px-2.5 py-1 bg-surface-100 text-surface-600 rounded-full text-xs font-semibold">
                            {item.source}
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h3 className="font-bold text-surface-900 mb-1">
                        {item.title || 'Untitled'}
                      </h3>

                      {/* Description (truncated) */}
                      {item.description && (
                        <p className="text-surface-500 text-sm mb-2 line-clamp-2">
                          {item.description}
                        </p>
                      )}

                      {/* Hackathon-specific: themes, organizer, mode */}
                      {item._type === 'HACKATHON' && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-surface-500 mb-2">
                          {themes.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {themes.map((t: string) => (
                                <span key={t} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-[10px] font-semibold">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                          {item.organizer && (
                            <span className="flex items-center gap-1">
                              <Building2 size={11} className="text-primary-500" />
                              {item.organizer}
                            </span>
                          )}
                          {item.mode && (
                            <span className="px-2 py-0.5 bg-surface-50 rounded-md">{item.mode}</span>
                          )}
                        </div>
                      )}

                      {/* Internship-specific: company, role, stipend */}
                      {item._type === 'INTERNSHIP' && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-surface-500 mb-2">
                          {item.company && (
                            <span className="flex items-center gap-1">
                              <Building2 size={11} className="text-primary-500" />
                              {item.company}
                            </span>
                          )}
                          {item.role && (
                            <span className="flex items-center gap-1">
                              <Briefcase size={11} className="text-primary-500" />
                              {item.role}
                            </span>
                          )}
                          {item.stipend && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 rounded-md font-medium">
                              <IndianRupee size={10} />
                              {item.stipend}
                            </span>
                          )}
                          {item.duration && (
                            <span className="flex items-center gap-1 px-2 py-0.5 bg-surface-50 rounded-md">
                              <Clock size={10} />
                              {item.duration}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Departments & Years badges */}
                      {(depts.length > 0 || years.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          {depts.length > 0 && depts[0] !== 'ALL' && depts.map((d: string) => (
                            <span key={d} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-[10px] font-semibold">
                              {d}
                            </span>
                          ))}
                          {depts.length > 0 && depts[0] === 'ALL' && (
                            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-[10px] font-semibold">
                              All Depts
                            </span>
                          )}
                          {years.length > 0 && years.length < 4 && years.map((y: number) => (
                            <span key={y} className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-[10px] font-semibold">
                              Year {y}
                            </span>
                          ))}
                          {years.length === 4 && (
                            <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-md text-[10px] font-semibold">
                              All Years
                            </span>
                          )}
                        </div>
                      )}

                      {/* URL link */}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-500 hover:underline flex items-center gap-1 text-xs"
                        >
                          <ExternalLink size={10} />
                          View Details
                        </a>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 bg-surface-100 text-surface-700 rounded-xl text-sm font-medium hover:bg-surface-200 transition-all"
                        >
                          <ExternalLink size={14} />
                          Details
                        </a>
                      )}
                      <button
                        onClick={() => handleApprove(item.id, item._type)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-xl text-sm font-medium hover:bg-primary-600 transition-all"
                      >
                        <CheckCircle2 size={14} />
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(item.id, item._type)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-danger-500 text-white rounded-xl text-sm font-medium hover:bg-danger-600 transition-all"
                      >
                        <XCircle size={14} />
                        Reject
                      </button>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

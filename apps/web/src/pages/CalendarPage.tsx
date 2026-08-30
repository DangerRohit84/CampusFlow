import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin, BookOpen, FileText, Trophy, Target, CheckSquare } from 'lucide-react'
import { timetableAPI, assignmentAPI, taskAPI, codingContestAPI, hackathonAPI, formAPI } from '../lib/api'

type CalendarEvent = {
  id: string
  type: 'class' | 'assignment' | 'task' | 'contest' | 'hackathon' | 'form'
  title: string
  date: string // YYYY-MM-DD
  time?: string
  endTime?: string
  location?: string
  completed?: boolean
  platform?: string
  dayOfWeek?: string
}

type TimetableClass = {
  id: string
  title: string
  dayOfWeek: 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'
  startTime: string
  endTime: string
  location?: string
}

const EVENT_COLORS: Record<string, { light: string; dark: string; bg: string; darkBg: string }> = {
  class: { light: '#007060', dark: '#90B9A4', bg: 'bg-primary-50', darkBg: 'dark:bg-teal-500/15' },
  assignment: { light: '#EF4444', dark: '#EF4444', bg: 'bg-red-100', darkBg: 'dark:bg-red-500/15' },
  task: { light: '#3B82F6', dark: '#3B82F6', bg: 'bg-blue-100', darkBg: 'dark:bg-blue-500/15' },
  contest: { light: '#8B5CF6', dark: '#8B5CF6', bg: 'bg-purple-100', darkBg: 'dark:bg-purple-500/15' },
  hackathon: { light: '#F97316', dark: '#F97316', bg: 'bg-orange-100', darkBg: 'dark:bg-orange-500/15' },
  form: { light: '#6B7280', dark: '#9CA3AF', bg: 'bg-gray-100', darkBg: 'dark:bg-gray-500/15' },
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_MAP: Record<string, number> = {
  MONDAY: 0, TUESDAY: 1, WEDNESDAY: 2, THURSDAY: 3, FRIDAY: 4, SATURDAY: 5, SUNDAY: 6,
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1 // Convert Sunday=0 to Monday-based (Mon=0)
}

function toISODate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function CalendarPage() {
  const today = new Date()
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string | null>(toISODate(today.getFullYear(), today.getMonth(), today.getDate()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch all data sources
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      const [classes, assignments, tasks, contests, hackathons, forms] = await Promise.all([
        timetableAPI.getAll().catch(() => []),
        assignmentAPI.getAll().catch(() => []),
        taskAPI.getRange(toISODate(currentYear, currentMonth, 1), toISODate(currentYear, currentMonth, getDaysInMonth(currentYear, currentMonth))).catch(() => []),
        codingContestAPI.getAll().catch(() => []),
        hackathonAPI.getAll().catch(() => []),
        formAPI.getAll().catch(() => []),
      ])

      const allEvents: CalendarEvent[] = []

      // Process recurring classes
      const classList: TimetableClass[] = Array.isArray(classes) ? classes : []
      const daysInMonth = getDaysInMonth(currentYear, currentMonth)
      for (const cls of classList) {
        const targetDay = DAY_MAP[cls.dayOfWeek]
        if (targetDay === undefined) continue
        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(currentYear, currentMonth, day)
          if (date.getDay() === (targetDay + 1) % 7) { // JS Sunday=0
            allEvents.push({
              id: `class-${cls.id}-${day}`,
              type: 'class',
              title: cls.title,
              date: toISODate(currentYear, currentMonth, day),
              time: cls.startTime,
              endTime: cls.endTime,
              location: cls.location,
              dayOfWeek: cls.dayOfWeek,
            })
          }
        }
      }

      // Process assignments
      const assignmentList: any[] = Array.isArray(assignments) ? assignments : []
      for (const a of assignmentList) {
        if (a.dueDate) {
          const dateStr = a.dueDate.slice(0, 10)
          allEvents.push({
            id: `assignment-${a.id}`,
            type: 'assignment',
            title: a.title || a.name || 'Assignment',
            date: dateStr,
            time: a.dueDate.slice(11, 16),
          })
        }
      }

      // Process tasks
      const taskList: any[] = Array.isArray(tasks) ? tasks : (tasks?.tasks || [])
      for (const t of taskList) {
        if (t.date) {
          allEvents.push({
            id: `task-${t.id}`,
            type: 'task',
            title: t.title || 'Task',
            date: t.date,
            time: t.startTime,
            completed: t.completed,
          })
        }
      }

      // Process contests
      const contestList: any[] = Array.isArray(contests) ? contests : []
      for (const c of contestList) {
        if (c.startDate) {
          const dateStr = c.startDate.slice(0, 10)
          allEvents.push({
            id: `contest-${c.id}`,
            type: 'contest',
            title: c.title || c.name || 'Contest',
            date: dateStr,
            time: c.startDate.slice(11, 16),
            platform: c.platform,
          })
        }
      }

      // Process hackathons
      const hackathonList: any[] = Array.isArray(hackathons) ? hackathons : []
      for (const h of hackathonList) {
        if (h.deadline) {
          const dateStr = h.deadline.slice(0, 10)
          allEvents.push({
            id: `hackathon-${h.id}`,
            type: 'hackathon',
            title: h.title || h.name || 'Hackathon',
            date: dateStr,
            time: h.deadline.slice(11, 16),
          })
        }
      }

      // Process forms
      const formList: any[] = Array.isArray(forms) ? forms : []
      for (const f of formList) {
        if (f.expiresAt) {
          const dateStr = f.expiresAt.slice(0, 10)
          allEvents.push({
            id: `form-${f.id}`,
            type: 'form',
            title: f.title || 'Form',
            date: dateStr,
            time: f.expiresAt.slice(11, 16),
          })
        }
      }

      setEvents(allEvents)
      setLoading(false)
    }

    fetchAll()
  }, [currentYear, currentMonth])

  // Events grouped by date
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      if (!map[e.date]) map[e.date] = []
      map[e.date].push(e)
    }
    return map
  }, [events])

  const selectedEvents = selectedDate ? eventsByDate[selectedDate] || [] : []

  // Calendar grid
  const daysInMonth = getDaysInMonth(currentYear, currentMonth)
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth)
  const calendarDays: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) calendarDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d)

  const todayISO = toISODate(today.getFullYear(), today.getMonth(), today.getDate())

  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }

  const goToToday = () => {
    setCurrentYear(today.getFullYear())
    setCurrentMonth(today.getMonth())
    setSelectedDate(todayISO)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center shadow-lg">
            <CalendarDays className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-night-50">Calendar</h1>
            <p className="text-sm text-surface-500 dark:text-night-300">All your events in one view</p>
          </div>
        </div>
        <button
          onClick={goToToday}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-primary-600 hover:bg-primary-700 dark:bg-[#90B9A4] dark:hover:bg-[#A8C2B3] text-white transition-colors"
        >
          Today
        </button>
      </div>

      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={goToPrevMonth}
          className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-night-700 text-surface-600 dark:text-night-200 transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-night-50">
          {formatMonthYear(currentYear, currentMonth)}
        </h2>
        <button
          onClick={goToNextMonth}
          className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-night-700 text-surface-600 dark:text-night-200 transition-colors"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(EVENT_COLORS).map(([type, colors]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.light }} />
            <span className="text-surface-600 dark:text-night-200 capitalize">{type}</span>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 overflow-hidden">
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-surface-200 dark:border-night-600">
          {DAY_LABELS.map((day) => (
            <div
              key={day}
              className="py-3 text-center text-xs font-semibold text-surface-500 dark:text-night-300 uppercase tracking-wider"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="h-24 border-b border-r border-surface-100 dark:border-night-650" />
            }

            const dateStr = toISODate(currentYear, currentMonth, day)
            const isToday = dateStr === todayISO
            const isSelected = dateStr === selectedDate
            const dayEvents = eventsByDate[dateStr] || []
            const visibleEvents = dayEvents.slice(0, 3)
            const extraCount = dayEvents.length - 3

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`h-24 border-b border-r border-surface-100 dark:border-night-650 p-1.5 cursor-pointer transition-colors hover:bg-surface-50 dark:bg-night-800 dark:hover:bg-night-850 ${
                  isSelected ? 'bg-primary-50 dark:bg-[rgba(45,106,79,0.12)]' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday
                        ? 'bg-primary-600 dark:bg-[#90B9A4] text-white ring-2 ring-primary-400 dark:ring-[#A8C2B3]'
                        : isSelected
                        ? 'bg-primary-100 dark:bg-[rgba(45,106,79,0.18)] text-primary-700 dark:text-[#90B9A4]'
                        : 'text-surface-700 dark:text-[#CBD5E1]'
                    }`}
                  >
                    {day}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {visibleEvents.map((evt) => (
                    <div
                      key={evt.id}
                      className="truncate text-[10px] font-medium px-1 py-0.5 rounded"
                      style={{
                        backgroundColor: `${EVENT_COLORS[evt.type].light}20`,
                        color: EVENT_COLORS[evt.type].light,
                      }}
                    >
                      {evt.title}
                    </div>
                  ))}
                  {extraCount > 0 && (
                    <div className="text-[10px] text-surface-500 dark:text-night-300 font-medium px-1">
                      +{extraCount} more
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Day Detail Panel */}
      <AnimatePresence mode="wait">
        {selectedDate && (
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-surface-900 dark:text-night-50">
                {formatDateLabel(selectedDate)}
              </h3>
              <span className="text-sm text-surface-500 dark:text-night-300">
                {selectedEvents.length} event{selectedEvents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : selectedEvents.length === 0 ? (
              <div className="text-center py-8">
                <CalendarDays className="w-12 h-12 text-surface-300 dark:text-[#232F3B] mx-auto mb-3" />
                <p className="text-surface-500 dark:text-night-300">No events on this day</p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedEvents.map((evt) => {
                  const colors = EVENT_COLORS[evt.type]
                  const Icon = evt.type === 'class' ? BookOpen
                    : evt.type === 'assignment' ? FileText
                    : evt.type === 'task' ? CheckSquare
                    : evt.type === 'contest' ? Trophy
                    : evt.type === 'hackathon' ? Target
                    : FileText

                  return (
                    <div
                      key={evt.id}
                      className="flex items-start gap-3 p-3 rounded-xl bg-white dark:bg-night-850 border border-surface-100 dark:border-night-650"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${colors.light}20` }}
                      >
                        <Icon size={16} style={{ color: colors.light }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${colors.light}20`,
                              color: colors.light,
                            }}
                          >
                            {evt.type}
                          </span>
                          {evt.platform && (
                            <span className="text-[10px] text-surface-500 dark:text-night-300">
                              {evt.platform}
                            </span>
                          )}
                          {evt.type === 'task' && evt.completed && (
                            <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                              Completed
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-surface-900 dark:text-night-50 truncate">
                          {evt.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs text-surface-500 dark:text-night-300">
                          {evt.time && (
                            <span className="flex items-center gap-1">
                              <Clock size={12} />
                              {evt.time}
                              {evt.endTime && ` - ${evt.endTime}`}
                            </span>
                          )}
                          {evt.location && (
                            <span className="flex items-center gap-1">
                              <MapPin size={12} />
                              {evt.location}
                            </span>
                          )}
                          {evt.type === 'class' && evt.dayOfWeek && (
                            <span className="text-surface-400 dark:text-[#8A9BA8] italic">
                              Recurring every {evt.dayOfWeek.charAt(0) + evt.dayOfWeek.slice(1).toLowerCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

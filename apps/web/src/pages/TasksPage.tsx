import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Sparkles, Trash2, Check, Clock, Calendar as CalIcon,
  ChevronDown, Loader2, ListTodo, AlertCircle
} from 'lucide-react'
import toast from 'react-hot-toast'
import { taskAPI } from '../lib/api'

type Task = {
  id: string
  title: string
  description?: string
  date: string
  startTime?: string
  endTime?: string
  priority?: 'LOW' | 'MEDIUM' | 'HIGH'
  category?: string
  completed?: boolean
}

type AiScheduleItem = {
  task: string
  startTime: string
  endTime: string
  duration: string
  reason: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const priorityConfig: Record<string, { bg: string; text: string; label: string }> = {
  HIGH: { bg: 'bg-red-100 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-400', label: 'HIGH' },
  MEDIUM: { bg: 'bg-amber-100 dark:bg-amber-500/15', text: 'text-amber-700 dark:text-amber-400', label: 'MED' },
  LOW: { bg: 'bg-gray-100 dark:bg-gray-500/15', text: 'text-gray-600 dark:text-gray-400', label: 'LOW' },
}

const categoryColors: Record<string, string> = {
  study: '#90B9A4',
  personal: '#8B5CF6',
  assignment: '#F59E0B',
  other: '#71808C',
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming' | 'all' | 'completed'>('today')
  const [newTitle, setNewTitle] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [newDesc, setNewDesc] = useState('')
  const [newDate, setNewDate] = useState(todayISO())
  const [newStart, setNewStart] = useState('')
  const [newEnd, setNewEnd] = useState('')
  const [newPriority, setNewPriority] = useState<string>('MEDIUM')
  const [newCategory, setNewCategory] = useState('other')
  const [creating, setCreating] = useState(false)

  // AI Summary
  const [showSummary, setShowSummary] = useState(false)
  const [summaryData, setSummaryData] = useState<any>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const summaryCacheRef = useRef<{ data: any; tasksHash: string } | null>(null)

  // AI Schedule
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduleInput, setScheduleInput] = useState('')
  const [scheduleResults, setScheduleResults] = useState<AiScheduleItem[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      if (activeTab === 'today') {
        const data = await taskAPI.getToday()
        setTasks(Array.isArray(data) ? data : data.tasks || [])
      } else {
        const data = await taskAPI.getAll()
        setTasks(Array.isArray(data) ? data : data.tasks || [])
      }
    } catch {
      toast.error('Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Filtered tasks
  const filteredTasks = tasks.filter((t) => {
    if (activeTab === 'today') return t.date === todayISO()
    if (activeTab === 'completed') return t.completed
    if (activeTab === 'upcoming') {
      return !t.completed && t.date > todayISO()
    }
    // 'all'
    return true
  })

  const today = todayISO()
  const isOverdue = (t: Task) => !t.completed && t.date < today

  // Create task
  const handleCreate = async () => {
    if (!newTitle.trim()) {
      toast.error('Enter a task title')
      return
    }
    setCreating(true)
    try {
      await taskAPI.create({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        date: newDate || todayISO(),
        startTime: newStart || undefined,
        endTime: newEnd || undefined,
        priority: newPriority,
        category: newCategory,
      })
      toast.success('Task created!')
      setNewTitle('')
      setNewDesc('')
      setNewDate(todayISO())
      setNewStart('')
      setNewEnd('')
      setNewPriority('MEDIUM')
      setNewCategory('other')
      setShowAdvanced(false)
      fetchTasks()
    } catch {
      toast.error('Failed to create task')
    } finally {
      setCreating(false)
    }
  }

  // Toggle task
  const handleToggle = async (id: string) => {
    try {
      await taskAPI.toggle(id)
      setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))
      toast.success('Task updated')
    } catch {
      toast.error('Failed to update task')
    }
  }

  // Delete task
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this task?')) return
    try {
      await taskAPI.delete(id)
      setTasks(prev => prev.filter(t => t.id !== id))
      toast.success('Task deleted')
    } catch {
      toast.error('Failed to delete task')
    }
  }

  // AI Summary
  const handleSummary = async () => {
    const hash = JSON.stringify(tasks.map(t => ({ id: t.id, completed: t.completed })))
    if (summaryCacheRef.current?.tasksHash === hash && summaryData) {
      setShowSummary(true)
      return
    }
    setSummaryLoading(true)
    setShowSummary(true)
    try {
      const data = await taskAPI.dailySummary()
      setSummaryData(data)
      summaryCacheRef.current = { data, tasksHash: hash }
    } catch {
      toast.error('Failed to get summary')
    } finally {
      setSummaryLoading(false)
    }
  }

  // AI Schedule
  const handleAiSchedule = async () => {
    const lines = scheduleInput.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) {
      toast.error('Enter at least one task')
      return
    }
    setScheduleLoading(true)
    try {
      const data = await taskAPI.aiSchedule(lines, todayISO())
      setScheduleResults(Array.isArray(data) ? data : data.schedule || [])
    } catch {
      toast.error('AI scheduling failed')
    } finally {
      setScheduleLoading(false)
    }
  }

  const handleAddScheduled = async (item: AiScheduleItem) => {
    try {
      await taskAPI.create({
        title: item.task,
        date: todayISO(),
        startTime: item.startTime,
        endTime: item.endTime,
      })
      toast.success('Added!')
    } catch {
      toast.error('Failed to add task')
    }
  }

  const tabCounts = {
    today: tasks.filter(t => t.date === todayISO() && !t.completed).length,
    upcoming: tasks.filter(t => !t.completed && t.date > todayISO()).length,
    all: tasks.length,
    completed: tasks.filter(t => t.completed).length,
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-extrabold text-surface-900 leading-none dark:text-night-50">Planner</h1>
          <p className="text-sm text-surface-500 dark:text-night-300 mt-0.5">{formatDate(todayISO())}</p>
        </div>
        <button
          onClick={handleSummary}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 dark:bg-brass-500 dark:hover:bg-brass-400 text-white dark:text-night-950 rounded-xl text-sm font-medium transition-colors"
        >
          <Sparkles size={16} />
          AI Day Summary
        </button>
      </div>

      {/* AI Summary Card */}
      <AnimatePresence>
        {showSummary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-primary-600 dark:text-brass-400" />
                  <span className="font-semibold text-surface-900 dark:text-night-50">AI Day Summary</span>
                </div>
                <button onClick={() => setShowSummary(false)} className="text-surface-400 hover:text-surface-600 dark:text-night-300 dark:hover:text-night-200 text-sm">✕S"</button>
              </div>
              {summaryLoading ? (
                <div className="flex items-center gap-2 text-surface-500 dark:text-night-300">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Generating summary...</span>
                </div>
              ) : summaryData ? (
                <div className="space-y-3">
                  <p className="text-sm text-surface-700 dark:text-night-200 leading-relaxed">{summaryData.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Total Tasks', value: summaryData.stats?.totalTasks },
                      { label: 'Completed', value: summaryData.stats?.completedTasks },
                      { label: 'Pending', value: summaryData.stats?.pendingTasks },
                      { label: 'Classes', value: summaryData.stats?.totalClasses },
                    ].filter(s => s.value !== undefined).map(s => (
                      <span key={s.label} className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-lg text-xs font-medium text-surface-700 dark:text-night-200">
                        <span className="text-primary-600 dark:text-brass-400">{s.value}</span> {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-surface-500 dark:text-night-300">No summary available.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Add */}
      <div className="bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 p-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-primary-100 dark:bg-brass-500/15 flex items-center justify-center shrink-0">
            <Plus size={16} className="text-primary-600 dark:text-brass-500" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !showAdvanced) handleCreate() }}
            placeholder="What needs to be done?"
            className="flex-1 border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-4 py-2.5 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
          />
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 px-3 py-2 text-sm text-surface-500 dark:text-night-300 hover:text-surface-700 dark:hover:text-night-200 transition-colors"
          >
            Advanced
            <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 dark:bg-brass-500 dark:hover:bg-brass-400 text-white dark:text-night-950 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : 'Add'}
          </button>
        </div>

        <AnimatePresence>
          {showAdvanced && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Description</label>
                  <textarea
                    value={newDesc}
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="Optional description..."
                    rows={2}
                    className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Date</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Start</label>
                    <input
                      type="time"
                      value={newStart}
                      onChange={e => setNewStart(e.target.value)}
                      className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">End</label>
                    <input
                      type="time"
                      value={newEnd}
                      onChange={e => setNewEnd(e.target.value)}
                      className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={e => setNewPriority(e.target.value)}
                    className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all"
                  >
                    <option value="study">Study</option>
                    <option value="personal">Personal</option>
                    <option value="assignment">Assignment</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-surface-100 dark:bg-night-800 rounded-xl p-1 w-fit">
        {[
          { key: 'today', label: 'Today' },
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'all', label: 'All' },
          { key: 'completed', label: 'Completed' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white dark:bg-night-650 text-primary-600 dark:text-brass-400 shadow-sm'
                : 'text-surface-500 dark:text-night-300 hover:text-surface-700 dark:hover:text-night-200'
            }`}
          >
            {tab.label}
            {tabCounts[tab.key as keyof typeof tabCounts] > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${
                activeTab === tab.key
                  ? 'bg-primary-100 dark:bg-brass-500/20 text-primary-700 dark:text-brass-400'
                  : 'bg-surface-200 dark:bg-night-600 text-surface-500 dark:text-night-300'
              }`}>
                {tabCounts[tab.key as keyof typeof tabCounts]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center min-h-[45vh]"><Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-surface-100 dark:bg-night-800 flex items-center justify-center mb-4">
              <ListTodo size={28} className="text-surface-400 dark:text-night-300" />
            </div>
            <p className="text-surface-500 dark:text-night-300 font-medium">
              {activeTab === 'today' && "No tasks for today  🎉  enjoy your free time!"}
              {activeTab === 'upcoming' && "No upcoming tasks. You're all caught up!"}
              {activeTab === 'all' && "No tasks yet. Add one above to get started."}
              {activeTab === 'completed' && "No completed tasks yet. Keep working!"}
            </p>
          </motion.div>
        ) : (
          filteredTasks.map((task, i) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 p-4 transition-all ${
                task.completed ? 'opacity-60' : ''
              } ${isOverdue(task) ? 'border-l-4 border-l-red-400 dark:border-l-red-500' : ''}`}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={() => handleToggle(task.id)}
                  className={`mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                    task.completed
                      ? 'bg-primary-600 dark:bg-brass-500 border-primary-600 dark:border-brass-500'
                      : 'border-surface-300 dark:border-night-300 hover:border-primary-400'
                  }`}
                >
                  {task.completed && <Check size={14} className="text-white dark:text-night-950" />}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${task.completed ? 'line-through text-surface-400 dark:text-night-300' : 'text-surface-900 dark:text-night-50'}`}>
                      {task.title}
                    </span>
                    {task.priority && priorityConfig[task.priority] && (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold ${priorityConfig[task.priority].bg} ${priorityConfig[task.priority].text}`}>
                        {priorityConfig[task.priority].label}
                      </span>
                    )}
                    {task.category && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-surface-500 dark:text-night-300">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: categoryColors[task.category] || categoryColors.other }} />
                        {task.category}
                      </span>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-xs text-surface-500 dark:text-night-300 mt-1 line-clamp-2">{task.description}</p>
                  )}
                  {task.startTime && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-surface-500 dark:text-night-300">
                      <Clock size={12} />
                      <span>{task.startTime}{task.endTime ? ` – ${task.endTime}` : ''}</span>
                    </div>
                  )}
                </div>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(task.id)}
                  className="p-1.5 rounded-lg text-surface-400 dark:text-night-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                  onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '')}
                  style={{ opacity: undefined }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* AI Auto-Schedule */}
      <div className="bg-surface-50 border border-surface-200 rounded-2xl dark:bg-night-800 dark:border-night-600 p-5">
        <button
          onClick={() => setShowSchedule(!showSchedule)}
          className="flex items-center gap-2 text-sm font-medium text-surface-700 dark:text-night-200 hover:text-surface-900 dark:text-night-50 dark:hover:text-night-50 transition-colors w-full"
        >
          <Sparkles size={16} className="text-primary-600 dark:text-brass-400" />
          <span>AI Auto-Schedule</span>
          <ChevronDown size={14} className={`ml-auto transition-transform ${showSchedule ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {showSchedule && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-surface-500 dark:text-night-300 mb-1">Enter tasks (one per line)</label>
                  <textarea
                    value={scheduleInput}
                    onChange={e => setScheduleInput(e.target.value)}
                    placeholder={"Review math notes\nWrite lab report\nExercise for 30 min"}
                    rows={4}
                    className="w-full border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 rounded-xl px-3 py-2 text-sm text-surface-900 dark:text-night-50 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all resize-none"
                  />
                </div>
                <button
                  onClick={handleAiSchedule}
                  disabled={scheduleLoading}
                  className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 dark:bg-brass-500 dark:hover:bg-brass-400 text-white dark:text-night-950 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {scheduleLoading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  Schedule with AI
                </button>

                {/* Results */}
                {scheduleResults.length > 0 && (
                  <div className="space-y-3">
                    {scheduleResults.map((item, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="bg-white dark:bg-night-850 border border-surface-200 dark:border-night-600 rounded-xl p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Clock size={14} className="text-primary-600 dark:text-brass-400 shrink-0" />
                              <span className="text-sm font-medium text-surface-900 dark:text-night-50">{item.task}</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-surface-500 dark:text-night-300">
                              <span>{item.startTime}  –  {item.endTime}</span>
                              <span className="px-1.5 py-0.5 bg-surface-100 dark:bg-night-650 rounded text-[10px] font-medium">{item.duration}</span>
                            </div>
                            {item.reason && (
                              <p className="text-xs text-surface-400 dark:text-night-300 mt-1 italic">{item.reason}</p>
                            )}
                          </div>
                          <button
                            onClick={() => handleAddScheduled(item)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-primary-100 dark:bg-brass-500/15 text-primary-700 dark:text-brass-400 rounded-lg text-xs font-medium hover:bg-primary-200 dark:hover:bg-brass-500/25 transition-colors shrink-0"
                          >
                            <Plus size={12} /> Add
                          </button>
                        </div>
                      </motion.div>
                    ))}
                    <p className="text-xs text-surface-400 dark:text-night-300 italic text-center">
                      Suggestions only  —  tap Add to create
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

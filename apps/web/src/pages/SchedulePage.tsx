import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Clock, Sparkles, Trash2, Edit3, Check, ChevronLeft, ChevronRight,
  CalendarDays, Upload, FileText, Zap, Image, X, AlertCircle
} from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { timetableAPI, taskAPI } from '../lib/api'

function getActiveProvider() {
  try {
    const configs = JSON.parse(localStorage.getItem('campusflow-ai-configs') || '[]')
    const active = localStorage.getItem('campusflow-active-ai') || ''
    const found = configs.find((c: any) => c.provider === active && c.enabled)
    return found ? { baseUrl: found.baseUrl, apiKey: found.apiKey, model: found.model } : undefined
  } catch { return undefined }
}
import toast from 'react-hot-toast'

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const hours = Array.from({ length: 14 }, (_, i) => i + 7)

export default function SchedulePage() {
  const [schedules, setSchedules] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(new Date().getDay() === 0 ? 6 : new Date().getDay() - 1)

  // Upload modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploadMode, setUploadMode] = useState<'image' | 'text'>('text')
  const [timetableText, setTimetableText] = useState('')
  const [parsedClasses, setParsedClasses] = useState<any[]>([])
  const [parsing, setParsing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  // Task modal
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [taskForm, setTaskForm] = useState({ title: '', description: '', startTime: '09:00', endTime: '10:00', category: 'personal', priority: 'MEDIUM' })

  const load = async () => {
    try {
      const [s, t] = await Promise.all([timetableAPI.getAll(), taskAPI.getToday()])
      setSchedules(s)
      setTasks(t)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const dayClasses = useMemo(() => schedules.filter((s) => s.dayOfWeek === selectedDay).sort((a, b) => a.startTime.localeCompare(b.startTime)), [schedules, selectedDay])
  const dayTasks = useMemo(() => tasks.filter((t) => t.startTime && !t.completed), [tasks])

  // Merge classes + tasks into timeline
  const timeline = useMemo(() => {
    const items: any[] = []
    dayClasses.forEach((c) => items.push({ ...c, _type: 'class' }))
    dayTasks.forEach((t) => items.push({ id: t.id, title: t.title, startTime: t.startTime, endTime: t.endTime, location: t.location, color: '#845ef7', _type: 'task', _data: t }))
    items.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
    return items
  }, [dayClasses, dayTasks])

  // Parse timetable
  const handleParse = async () => {
    if (uploadMode === 'text' && !timetableText.trim()) { toast.error('Enter your timetable text'); return }
    if (uploadMode === 'image' && !file) { toast.error('Select an image'); return }

    setParsing(true)
    try {
      let result
      if (uploadMode === 'image' && file) {
        const provider = getActiveProvider()
        result = await timetableAPI.uploadImage(file, provider)
      } else {
        result = await timetableAPI.parseText(timetableText)
      }
      setParsedClasses(result.classes || [])
      if (result.classes?.length === 0) toast.error(result.message || 'No classes found. Try a different format.')
    } catch { toast.error('Failed to parse timetable') }
    setParsing(false)
  }

  // Save parsed classes
  const handleSaveClasses = async () => {
    if (parsedClasses.length === 0) return
    setUploading(true)
    try {
      await timetableAPI.save(parsedClasses, true)
      toast.success(`${parsedClasses.length} classes saved!`)
      setUploadModalOpen(false); setParsedClasses([]); setTimetableText(''); setFile(null)
      load()
    } catch { toast.error('Failed to save') }
    setUploading(false)
  }

  const handleDeleteClass = async (id: string) => {
    if (!confirm('Delete this class?')) return
    try { await fetch(`http://localhost:4000/api/schedules/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('campusflow-auth') || '{}').state?.token}` } }); toast.success('Deleted'); load() } catch { toast.error('Failed') }
  }

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return `${h > 12 ? h - 12 : h}:${m?.toString().padStart(2, '0') || '00'} ${h >= 12 ? 'PM' : 'AM'}`
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-surface-900">Timetable</h1>
          <p className="text-surface-500 mt-1">Upload your timetable or add classes manually</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setUploadModalOpen(true); setParsedClasses([]); setTimetableText(''); setFile(null) }}>
            <Upload size={16} /> Upload Timetable
          </Button>
        </div>
      </motion.div>

      {/* Day Tabs */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="flex gap-2 overflow-x-auto pb-2">
        {days.map((day, i) => {
          const classCount = schedules.filter((s) => s.dayOfWeek === i).length
          return (
            <button key={day} onClick={() => setSelectedDay(i)}
              className={`flex flex-col items-center px-4 py-3 rounded-xl font-medium transition-all duration-200 shrink-0 min-w-[70px] ${selectedDay === i ? 'bg-gradient-to-br from-primary-600 to-primary-600 text-white shadow-lg shadow-primary-500/25' : 'bg-white text-surface-600 hover:bg-surface-50 border border-surface-200'}`}>
              <span className="text-[10px] opacity-80">{dayShort[i]}</span>
              <span className="text-lg font-bold mt-0.5">{14 + i}</span>
              {classCount > 0 && selectedDay !== i && <div className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1" />}
            </button>
          )
        })}
      </motion.div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2">
          <Card padding="none" hover className="overflow-hidden">
            <div className="p-5 pb-3 flex items-center justify-between border-b border-surface-100">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-primary-600" />
                <h3 className="font-bold text-surface-900">{days[selectedDay]}</h3>
              </div>
              <Badge variant="primary">{timeline.length} items</Badge>
            </div>

            <div className="p-5">
              {loading ? (
                <div className="text-center py-16 text-surface-400">Loading...</div>
              ) : timeline.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-surface-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <CalendarDays className="w-8 h-8 text-surface-400" />
                  </div>
                  <p className="text-surface-500 font-medium mb-2">No classes on {days[selectedDay]}</p>
                  <p className="text-sm text-surface-400 mb-4">Upload your timetable to get started</p>
                  <Button size="sm" onClick={() => setUploadModalOpen(true)}><Upload size={16} /> Upload Timetable</Button>
                </div>
              ) : (
                <div className="space-y-1">
                  {hours.map((hour) => {
                    const hourStr = hour.toString().padStart(2, '0')
                    const itemsAtHour = timeline.filter((t) => t.startTime?.startsWith(hourStr))
                    if (itemsAtHour.length === 0) return null

                    return (
                      <div key={hour} className="flex gap-4 min-h-[60px] group">
                        <div className="w-14 shrink-0 text-right pt-1">
                          <span className="text-xs font-medium text-surface-400">{formatTime(`${hourStr}:00`)}</span>
                        </div>
                        <div className="flex-1 border-l-2 border-surface-100 pl-4 relative">
                          <div className="absolute left-[-5px] top-3 w-2 h-2 rounded-full bg-surface-200 group-hover:bg-primary-400 transition-colors" />
                          {itemsAtHour.map((item) => (
                            <motion.div key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                              className="mb-2 p-3 rounded-xl border-l-4 bg-surface-50 hover:bg-surface-100 transition-all group/item cursor-pointer"
                              style={{ borderLeftColor: item.color || '#5c7cfa' }}>
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-sm text-surface-900">{item.title}</p>
                                    <Badge variant={item._type === 'class' ? 'primary' : 'accent'}>{item._type === 'class' ? 'CLASS' : 'TASK'}</Badge>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-xs text-surface-400 flex items-center gap-1"><Clock size={10} />{formatTime(item.startTime)} - {formatTime(item.endTime || item.startTime)}</span>
                                    {item.location && <span className="text-xs text-surface-400">· {item.location}</span>}
                                  </div>
                                  {item.teacher && <p className="text-[11px] text-surface-400 mt-1">{/^(Prof|Dr|Mr|Mrs|Ms|Sir|Ma'am)\./i.test(item.teacher) ? '' : 'Prof. '}{item.teacher}</p>}
                                </div>
                                {item._type === 'class' && (
                                   <button onClick={() => handleDeleteClass(item.id)} className="p-1 rounded text-surface-400 hover:text-danger-600 opacity-0 group-hover/item:opacity-100 transition-all"><Trash2 size={12} /></button>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        {/* Right Sidebar */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-6">
          {/* Week Overview */}
          <Card hover>
            <h3 className="font-bold text-surface-900 mb-4">Week Overview</h3>
            <div className="space-y-3">
              {days.map((day, i) => {
                const count = schedules.filter((s) => s.dayOfWeek === i).length
                const isSelected = selectedDay === i
                return (
                  <button key={day} onClick={() => setSelectedDay(i)} className={`w-full flex items-center gap-3 p-2 rounded-lg transition-all ${isSelected ? 'bg-primary-50 border border-primary-200' : 'hover:bg-surface-50'}`}>
                    <span className="text-xs font-medium text-surface-500 w-8">{dayShort[i]}</span>
                    <div className="flex-1 h-5 bg-surface-100 rounded overflow-hidden">
                      <div className="h-full bg-primary-500 rounded" style={{ width: `${(count / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold text-surface-700 w-6 text-right">{count}</span>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Stats */}
          <Card hover>
            <h3 className="font-bold text-surface-900 mb-4">Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-primary-50 rounded-xl text-center">
                <p className="text-2xl font-bold text-primary-600">{schedules.length}</p>
                <p className="text-[10px] text-primary-500 font-medium">Total Classes</p>
              </div>
              <div className="p-3 bg-primary-50 rounded-xl text-center">
                <p className="text-2xl font-bold text-primary-600">{new Set(schedules.map((s) => s.course || s.title)).size}</p>
                <p className="text-[10px] text-primary-500 font-medium">Subjects</p>
              </div>
              <div className="p-3 bg-primary-50 rounded-xl text-center">
                <p className="text-2xl font-bold text-primary-600">{schedules.filter((s) => s.type === 'LAB').length}</p>
                <p className="text-[10px] text-primary-500 font-medium">Labs</p>
              </div>
              <div className="p-3 bg-warning-50 rounded-xl text-center">
                <p className="text-2xl font-bold text-warning-600">{new Set(schedules.map((s) => s.dayOfWeek)).size}</p>
                <p className="text-[10px] text-warning-500 font-medium">Days Active</p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Upload Modal */}
      <Modal open={uploadModalOpen} onClose={() => setUploadModalOpen(false)} title="Add Timetable" size="lg">
        <div className="space-y-5">
          {/* Mode Toggle */}
          <div className="flex gap-2 bg-surface-100 p-1 rounded-xl">
            <button onClick={() => setUploadMode('text')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${uploadMode === 'text' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
              <FileText size={16} /> Paste Text
            </button>
            <button onClick={() => setUploadMode('image')} className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${uploadMode === 'image' ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500'}`}>
              <Image size={16} /> Upload Image
            </button>
          </div>

          {uploadMode === 'text' ? (
            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5">Paste your timetable text</label>
              <textarea value={timetableText} onChange={(e) => setTimetableText(e.target.value)} rows={10}
                className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none font-mono"
                placeholder={"Monday:\n9:00-10:30 - Data Structures - Room 301 - Prof. Sharma\n11:00-12:30 - Machine Learning - Hall A\n2:00-4:00 - DB Lab - Lab 204\n\nTuesday:\n9:00-10:30 - Data Structures - Room 301\n11:00-1:00 - ML Lab - Lab 204"} />
              <p className="text-[11px] text-surface-400 mt-1">Format: Day header, then time - subject - room - teacher (one per line)</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-semibold text-surface-700 mb-1.5">Upload timetable image</label>
              <div className="border-2 border-dashed border-surface-200 rounded-xl p-8 text-center hover:border-primary-300 transition-colors">
                {file ? (
                  <div className="space-y-2">
                    <div className="w-12 h-12 bg-primary-100 rounded-xl flex items-center justify-center mx-auto"><Image size={24} className="text-primary-600" /></div>
                    <p className="text-sm font-medium text-surface-900">{file.name}</p>
                    <button onClick={() => setFile(null)} className="text-xs text-danger-500 hover:text-danger-600">Remove</button>
                  </div>
                ) : (
                  <label className="cursor-pointer block">
                    <div className="w-12 h-12 bg-surface-100 rounded-xl flex items-center justify-center mx-auto mb-3"><Upload size={24} className="text-surface-400" /></div>
                    <p className="text-sm text-surface-500">Click to upload or drag and drop</p>
                    <p className="text-xs text-surface-400 mt-1">JPG, PNG, WebP up to 10MB</p>
                    <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/bmp,image/tiff,image/heic" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </div>
              <p className="text-[11px] text-surface-400 mt-2">Requires a vision AI model (OpenAI or Gemini) configured in Settings</p>
            </div>
          )}

          <Button onClick={handleParse} loading={parsing} className="w-full" variant="secondary">
            <Sparkles size={16} /> Parse Timetable
          </Button>

          {/* Parsed Results */}
          {parsedClasses.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-surface-900">Found {parsedClasses.length} classes</h4>
                <Badge variant="success">{parsedClasses.length} classes</Badge>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {parsedClasses.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 p-3 bg-surface-50 rounded-xl">
                    <div className="w-8 h-8 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 font-bold text-xs">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-900 truncate">{c.title}</p>
                      <p className="text-xs text-surface-400">{dayShort[c.dayOfWeek]} {c.startTime}-{c.endTime} · {c.location || 'No location'}</p>
                      {c.teacher && <p className="text-[11px] text-surface-400">{/^(Prof|Dr|Mr|Mrs|Ms|Sir|Ma'am)\./i.test(c.teacher) ? '' : 'Prof. '}{c.teacher}</p>}
                    </div>
                    <Badge variant={c.type === 'LAB' ? 'accent' : 'primary'}>{c.type}</Badge>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSaveClasses} loading={uploading} className="flex-1"><Zap size={16} /> Save to Timetable</Button>
              </div>
              <p className="text-xs text-surface-400 text-center">This will replace your existing timetable</p>
            </div>
          )}
        </div>
      </Modal>
    </motion.div>
  )
}
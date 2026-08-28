import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Clock, CheckCircle, Plus, Trash2, Edit3, FileText } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { assignmentAPI } from '../lib/api'
import toast from 'react-hot-toast'

const priorities = ['LOW', 'MEDIUM', 'HIGH']

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<any[]>([])
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'SUBMITTED' | 'GRADED'>('all')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ title: '', courseId: '', description: '', dueDate: '', priority: 'MEDIUM', progress: 0 })

  const load = () => assignmentAPI.getAll(filter === 'all' ? undefined : filter).then(setAssignments).catch(console.error).finally(() => setLoading(false))
  useEffect(() => { load() }, [filter])

  const daysUntil = (date: string) => {
    const diff = Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (diff < 0) return 'Overdue'
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return `${diff} days`
  }

  const openCreate = () => { setEditing(null); setForm({ title: '', courseId: '', description: '', dueDate: '', priority: 'MEDIUM', progress: 0 }); setModalOpen(true) }
  const openEdit = (a: any) => { setEditing(a); setForm({ title: a.title, courseId: a.courseId, description: a.description || '', dueDate: a.dueDate.split('T')[0], priority: a.priority, progress: a.progress }); setModalOpen(true) }

  const handleSave = async () => {
    if (!form.title.trim() || !form.courseId.trim()) { toast.error('Title and course are required'); return }
    try {
      const payload = { ...form, dueDate: new Date(form.dueDate).toISOString() }
      if (editing) { await assignmentAPI.update(editing.id, payload); toast.success('Assignment updated!') }
      else { await assignmentAPI.create(payload); toast.success('Assignment created!') }
      setModalOpen(false); load()
    } catch { toast.error('Failed to save') }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this assignment?')) return
    try { await assignmentAPI.delete(id); toast.success('Deleted'); load() } catch { toast.error('Failed to delete') }
  }

  const handleSubmit = async (id: string) => {
    try { await assignmentAPI.update(id, { status: 'SUBMITTED', progress: 100 }); toast.success('Assignment submitted!'); load() } catch { toast.error('Failed to submit') }
  }

  const stats = {
    total: assignments.length,
    pending: assignments.filter((a) => a.status === 'PENDING').length,
    submitted: assignments.filter((a) => a.status === 'SUBMITTED').length,
    graded: assignments.filter((a) => a.status === 'GRADED').length,
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div><h1 className="font-display text-xl font-extrabold text-surface-900 leading-none">Assignments</h1><p className="text-surface-500 mt-1">Track and manage all your assignments</p></div>
        <Button size="sm" onClick={openCreate}><Plus size={16} /> New Assignment</Button>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total, icon: FileText, color: 'text-surface-600', bg: 'bg-surface-100' },
          { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-warning-600', bg: 'bg-warning-50' },
          { label: 'Submitted', value: stats.submitted, icon: CheckCircle, color: 'text-primary-600', bg: 'bg-primary-50' },
          { label: 'Graded', value: stats.graded, icon: BookOpen, color: 'text-primary-600', bg: 'bg-primary-50' },
        ].map((s) => (
          <Card key={s.label} hover className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl ${s.bg} flex items-center justify-center`}><s.icon size={22} className={s.color} /></div>
            <div><p className="text-2xl font-bold text-surface-900">{s.value}</p><p className="text-xs text-surface-500">{s.label}</p></div>
          </Card>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-1 bg-surface-100 rounded-xl p-1 w-fit">
        {(['all', 'PENDING', 'SUBMITTED', 'GRADED'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === f ? 'bg-white text-surface-900 shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}>{f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}</button>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-3">
        {loading ? <div className="text-center py-12 text-surface-400">Loading...</div> : assignments.map((a: any) => {
          const due = daysUntil(a.dueDate)
          return (
            <Card key={a.id} hover className="group">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className={`w-1 h-16 sm:h-12 rounded-full shrink-0 ${a.priority === 'HIGH' ? 'bg-danger-500' : a.priority === 'MEDIUM' ? 'bg-warning-500' : 'bg-primary-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-surface-900 group-hover:text-primary-700 transition-colors">{a.title}</h3>
                        {a.status === 'GRADED' && <Badge variant="success">Graded: {a.grade}</Badge>}
                        {a.status === 'SUBMITTED' && <Badge variant="primary">Submitted</Badge>}
                        {due === 'Overdue' && a.status === 'PENDING' && <Badge variant="danger" dot>Overdue</Badge>}
                      </div>
                      <p className="text-sm text-surface-500 mt-0.5">{a.courseId}</p>
                      {a.description && <p className="text-xs text-surface-400 mt-1 line-clamp-1">{a.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${due === 'Tomorrow' || due === 'Overdue' || due === 'Today' ? 'text-danger-600' : due.includes('days') && parseInt(due) <= 3 ? 'text-warning-600' : 'text-surface-600'}`}>{due}</p>
                      <p className="text-xs text-surface-400 mt-0.5">{new Date(a.dueDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {a.status === 'PENDING' && (
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-1 h-2 bg-surface-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${a.progress >= 75 ? 'bg-primary-500' : a.progress >= 40 ? 'bg-warning-500' : 'bg-danger-500'}`} style={{ width: `${a.progress}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-surface-500">{a.progress}%</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {a.status === 'PENDING' && <Button size="sm" onClick={() => handleSubmit(a.id)}>Submit</Button>}
                  <button onClick={() => openEdit(a)} className="p-2 rounded-lg text-surface-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"><Edit3 size={14} /></button>
                  <button onClick={() => handleDelete(a.id)} className="p-2 rounded-lg text-surface-400 hover:text-danger-600 hover:bg-danger-50 transition-colors"><Trash2 size={14} /></button>
                </div>
              </div>
            </Card>
          )
        })}
      </motion.div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Assignment' : 'New Assignment'} size="lg">
        <div className="space-y-4">
          <Input label="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. ML Project Report" />
          <Input label="Course Code" value={form.courseId} onChange={(e) => setForm((p) => ({ ...p, courseId: e.target.value }))} placeholder="e.g. CS301" />
          <div><label className="block text-sm font-semibold text-surface-700 mb-1.5">Description</label><textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} rows={3} className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all resize-none" placeholder="Assignment details..." /></div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Due Date" type="date" value={form.dueDate} onChange={(e) => setForm((p) => ({ ...p, dueDate: e.target.value }))} />
            <div><label className="block text-sm font-semibold text-surface-700 mb-1.5">Priority</label><div className="flex gap-2">{priorities.map((p) => (<button key={p} onClick={() => setForm((prev) => ({ ...prev, priority: p }))} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${form.priority === p ? (p === 'HIGH' ? 'bg-danger-500 text-white' : p === 'MEDIUM' ? 'bg-warning-500 text-white' : 'bg-primary-500 text-white') : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}>{p}</button>))}</div></div>
          </div>
          {editing && (
            <div><label className="block text-sm font-semibold text-surface-700 mb-1.5">Progress: {form.progress}%</label><input type="range" min={0} max={100} value={form.progress} onChange={(e) => setForm((p) => ({ ...p, progress: parseInt(e.target.value) }))} className="w-full accent-primary-600" /></div>
          )}
          <div className="flex gap-3 pt-2"><Button variant="secondary" onClick={() => setModalOpen(false)} className="flex-1">Cancel</Button><Button onClick={handleSave} className="flex-1">{editing ? 'Update' : 'Create'}</Button></div>
        </div>
      </Modal>
    </motion.div>
  )
}
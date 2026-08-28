import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import ScopeSelector from './ScopeSelector'
import SubmissionModeToggle from './SubmissionModeToggle'
import VisibilityToggles from './VisibilityToggles'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

interface Props { open: boolean; hub?: any; onClose: ()=> void; onSaved: ()=> void }

export default function CreateAssignmentModal({ open, hub, onClose, onSaved }: Props) {
  const [form, setForm] = useState({ title:'', description:'', courseId:'', dueDate:'', scope:'ALL' as any, departmentId:null as any, roomId:null as any, submissionMode:'ONLINE' as any, showGrades:true, showFeedback:true, showSubmissionStatus:true, showStats:false, maxPoints:100, allowLateSubmission:false })
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(()=> { if(hub) setForm({ title: hub.title, description: hub.description||'', courseId: hub.courseId||'', dueDate: hub.dueDate?.slice(0,10)||'', scope: hub.scope, departmentId: hub.departmentId, roomId: hub.roomId, submissionMode: hub.submissionMode, showGrades: hub.showGrades, showFeedback: hub.showFeedback, showSubmissionStatus: hub.showSubmissionStatus, showStats: hub.showStats, maxPoints: hub.maxPoints, allowLateSubmission: hub.allowLateSubmission }) }, [hub, open])
  const handleSave = async ()=> {
    if(!form.title.trim()) { toast.error('Title required'); return }
    if(!form.dueDate) { toast.error('Due date required'); return }
    if(form.scope==='DEPARTMENT' && !form.departmentId) { toast.error('Select department'); return }
    if(form.scope==='ROOM' && !form.roomId) { toast.error('Select room'); return }
    setSaving(true)
    try {
      if (files.length) {
        const fd = new FormData()
        fd.append('title', form.title); fd.append('description', form.description); fd.append('courseId', form.courseId); fd.append('dueDate', new Date(form.dueDate).toISOString()); fd.append('scope', form.scope); if(form.departmentId) fd.append('departmentId', form.departmentId); if(form.roomId) fd.append('roomId', form.roomId); fd.append('submissionMode', form.submissionMode); fd.append('showGrades', String(form.showGrades)); fd.append('showFeedback', String(form.showFeedback)); fd.append('showSubmissionStatus', String(form.showSubmissionStatus)); fd.append('showStats', String(form.showStats)); fd.append('maxPoints', String(form.maxPoints)); fd.append('allowLateSubmission', String(form.allowLateSubmission)); files.forEach(f=> fd.append('attachments', f))
        if(hub) await assignmentHubAPI.update(hub.id, fd as any); else await assignmentHubAPI.create(fd as any)
      } else {
        const payload = { ...form, dueDate: new Date(form.dueDate).toISOString() }
        if(hub) await assignmentHubAPI.update(hub.id, payload); else await assignmentHubAPI.create(payload)
      }
      toast.success(hub?'Assignment updated':'Assignment created'); onSaved(); onClose()
    } catch(e:any){ toast.error(e.response?.data?.error||'Failed to save') } finally { setSaving(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={hub?'Edit Assignment':'New Assignment'} size="lg">
      <div className="space-y-5">
        <Input label="Title" value={form.title} onChange={e=> setForm(p=>({...p, title:e.target.value}))} placeholder="e.g. DSA Assignment 2" />
        <Input label="Course Code" value={form.courseId} onChange={e=> setForm(p=>({...p, courseId:e.target.value}))} placeholder="CS301" />
        <div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Description</label><textarea value={form.description} onChange={e=> setForm(p=>({...p, description:e.target.value}))} rows={3} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" placeholder="Details..." /></div>
        <div className="grid grid-cols-2 gap-4"><Input label="Due Date" type="date" value={form.dueDate} onChange={e=> setForm(p=>({...p, dueDate:e.target.value}))} /><div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Max Points</label><input type="number" value={form.maxPoints} onChange={e=> setForm(p=>({...p, maxPoints: parseInt(e.target.value)||0}))} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" /></div></div>
        <ScopeSelector value={form.scope} departmentId={form.departmentId} roomId={form.roomId} onChange={patch=> setForm(p=>({...p, ...patch}))} />
        <SubmissionModeToggle value={form.submissionMode} onChange={m=> setForm(p=>({...p, submissionMode:m}))} />
        <VisibilityToggles values={{ showGrades: form.showGrades, showFeedback: form.showFeedback, showSubmissionStatus: form.showSubmissionStatus, showStats: form.showStats }} onChange={patch=> setForm(p=>({...p, ...patch}))} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowLateSubmission} onChange={e=> setForm(p=>({...p, allowLateSubmission:e.target.checked}))}/> Allow late submissions</label>
        <div><label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Attachments (optional, up to 5)</label><input type="file" multiple onChange={e=> setFiles(Array.from(e.target.files||[]).slice(0,5))} className="w-full text-sm" /></div>
        <div className="flex gap-3 pt-2"><Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button onClick={handleSave} disabled={saving} className="flex-1">{saving?'Saving...':hub?'Update':'Create'}</Button></div>
      </div>
    </Modal>
  )
}

import { useState, useEffect, useMemo } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import ScopeSelector from './ScopeSelector'
import SubmissionModeToggle from './SubmissionModeToggle'
import VisibilityToggles from './VisibilityToggles'
import { assignmentHubAPI } from '../../lib/api'
import { queryClient } from '../../lib/queryClient'
import toast from 'react-hot-toast'
import { FileText, Calendar, Users, UploadCloud, Eye, Paperclip, Info, Award, Clock, AlertCircle, X, File } from 'lucide-react'

interface Props { open: boolean; hub?: any; onClose: ()=> void; onSaved: ()=> void }

type FormState = {
  title: string
  description: string
  courseId: string
  dueDate: string
  scope: 'ALL' | 'DEPARTMENT' | 'ROOM'
  departmentId: string | null
  roomId: string | null
  submissionMode: 'ONLINE' | 'OFFLINE' | 'HYBRID'
  showGrades: boolean
  showFeedback: boolean
  showSubmissionStatus: boolean
  showStats: boolean
  maxPoints: number
  allowLateSubmission: boolean
}

export default function CreateAssignmentModal({ open, hub, onClose, onSaved }: Props) {
  const [form, setForm] = useState<FormState>({ title:'', description:'', courseId:'', dueDate:'', scope:'ALL', departmentId:null, roomId:null, submissionMode:'ONLINE', showGrades:true, showFeedback:true, showSubmissionStatus:true, showStats:false, maxPoints:100, allowLateSubmission:false })
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string,string>>({})

  useEffect(()=> {
    if(open) {
      if(hub) setForm({ title: hub.title, description: hub.description||'', courseId: hub.courseId||'', dueDate: hub.dueDate?.slice(0,10)||'', scope: hub.scope, departmentId: hub.departmentId, roomId: hub.roomId, submissionMode: hub.submissionMode, showGrades: hub.showGrades, showFeedback: hub.showFeedback, showSubmissionStatus: hub.showSubmissionStatus, showStats: hub.showStats, maxPoints: hub.maxPoints, allowLateSubmission: hub.allowLateSubmission })
      else setForm({ title:'', description:'', courseId:'', dueDate:'', scope:'ALL', departmentId:null, roomId:null, submissionMode:'ONLINE', showGrades:true, showFeedback:true, showSubmissionStatus:true, showStats:false, maxPoints:100, allowLateSubmission:false })
      setFiles([]); setErrors({})
    }
  }, [hub, open])

  // live helpers
  const duePreview = useMemo(()=> {
    if(!form.dueDate) return null
    const d = new Date(form.dueDate)
    if(isNaN(d.getTime())) return null
    const diff = Math.ceil((d.getTime() - Date.now())/86400000)
    if(diff<0) return { text: 'This date is in the past', tone: 'danger' }
    if(diff===0) return { text: 'Due today', tone: 'warning' }
    if(diff===1) return { text: 'Due tomorrow', tone: 'warning' }
    if(diff<=7) return { text: `Due in ${diff} days`, tone: 'ok' }
    return { text: `Due ${d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric'})}`, tone: 'ok' }
  }, [form.dueDate])

  const scopePreview = useMemo(()=> {
    if(form.scope==='ALL') return 'Everyone in your college will see this assignment'
    if(form.scope==='DEPARTMENT') return form.departmentId ? 'Only students in the selected department will see it' : 'Choose a department below — only that department will see it'
    return form.roomId ? 'Only students in the selected classroom will see it' : 'Choose a classroom below — only that room will see it'
  }, [form.scope, form.departmentId, form.roomId])

  const modePreview = useMemo(()=> {
    if(form.submissionMode==='ONLINE') return 'Students will upload files or type answers online'
    if(form.submissionMode==='OFFLINE') return 'Students will hand in work in person — no online upload'
    return 'Students can choose: upload online or hand in offline'
  }, [form.submissionMode])

  const visibilitySummary = useMemo(()=> {
    const parts:string[]=[]
    if (form.showGrades) parts.push('grades')
    if (form.showFeedback) parts.push('feedback')
    if (form.showSubmissionStatus) parts.push('status')
    if (form.showStats) parts.push('class stats')
    if(parts.length===0) return 'Students won’t see grades or feedback until you change this'
    return `Students will see: ${parts.join(' • ')}`
  }, [form.showGrades, form.showFeedback, form.showSubmissionStatus, form.showStats])

  const validate = (): boolean => {
    const e: Record<string,string> = {}
    if(!form.title.trim()) e.title = 'Please add a title so students know what this is'
    else if(form.title.trim().length < 3) e.title = 'Title should be at least 3 characters'
    if(!form.dueDate) e.dueDate = 'Pick a due date'
    else {
      const d = new Date(form.dueDate)
      const today = new Date(); today.setHours(0,0,0,0)
      if(d < today) e.dueDate = 'Due date is in the past — are you sure?'
    }
    if(!form.maxPoints || form.maxPoints <=0) e.maxPoints = 'Points must be at least 1'
    if(form.scope==='DEPARTMENT' && !form.departmentId) e.scope = 'Please select a department'
    if(form.scope==='ROOM' && !form.roomId) e.scope = 'Please select a classroom'
    setErrors(e)
    // only block on critical errors (title, dueDate missing, scope missing); allow past date warning but still block? we show as error but allow? keep blocking if dueDate missing, but past date as warning — treat as error for now but toast will clarify
    const critical = { ...e }
    // if due date is past, don't block hard — just warn, so remove that if it's the past message
    if(e.dueDate === 'Due date is in the past — are you sure?') delete critical.dueDate
    return Object.keys(critical).length===0
  }

  const handleSave = async ()=> {
    if(!validate()) { toast.error('Please fix the highlighted fields'); return }
    // still warn if past due
    if(errors.dueDate) { /* past date warning already */ }
    setSaving(true)
    try {
      // Normalize dueDate: input type=date gives YYYY-MM-DD; convert to ISO at UTC midnight
      // Use T00:00:00 to avoid off-by-one timezone issues where new Date('2026-08-30') is UTC but UI expects local
      const isoDue = form.dueDate ? new Date(form.dueDate + 'T00:00:00').toISOString() : new Date(form.dueDate).toISOString()
      if (files.length) {
        const fd = new FormData()
        fd.append('title', form.title.trim())
        // Only send non-empty optional text fields — backend treats empty as undefined via preprocess
        if (form.description?.trim()) fd.append('description', form.description.trim())
        if (form.courseId?.trim()) fd.append('courseId', form.courseId.trim())
        fd.append('dueDate', isoDue)
        fd.append('scope', form.scope)
        // Scope-aware: only send relevant FK; backend validates ALL must have neither
        if (form.scope === 'DEPARTMENT' && form.departmentId) fd.append('departmentId', form.departmentId)
        if (form.scope === 'ROOM' && form.roomId) fd.append('roomId', form.roomId)
        fd.append('submissionMode', form.submissionMode)
        fd.append('showGrades', String(form.showGrades))
        fd.append('showFeedback', String(form.showFeedback))
        fd.append('showSubmissionStatus', String(form.showSubmissionStatus))
        fd.append('showStats', String(form.showStats))
        fd.append('maxPoints', String(form.maxPoints))
        fd.append('allowLateSubmission', String(form.allowLateSubmission))
        files.forEach(f=> fd.append('attachments', f))
        if(hub) await assignmentHubAPI.update(hub.id, fd as any); else await assignmentHubAPI.create(fd as any)
      } else {
        // JSON path — clean payload to avoid sending empty strings for optional fields
        const payload: any = {
          title: form.title.trim(),
          description: form.description?.trim() || undefined,
          courseId: form.courseId?.trim() || undefined,
          dueDate: isoDue,
          scope: form.scope,
          departmentId: form.scope === 'DEPARTMENT' ? form.departmentId : null,
          roomId: form.scope === 'ROOM' ? form.roomId : null,
          submissionMode: form.submissionMode,
          showGrades: form.showGrades,
          showFeedback: form.showFeedback,
          showSubmissionStatus: form.showSubmissionStatus,
          showStats: form.showStats,
          maxPoints: form.maxPoints,
          allowLateSubmission: form.allowLateSubmission,
        }
        // Remove nulls for ALL scope to satisfy backend's empty-check (null is ok, but undefined cleaner)
        if (payload.scope === 'ALL') { payload.departmentId = null; payload.roomId = null }
        if(hub) await assignmentHubAPI.update(hub.id, payload); else await assignmentHubAPI.create(payload)
      }
      toast.success(hub?'Assignment updated':'Assignment created');
      // invalidate queries so lists refetch with new/updated assignment
      queryClient.invalidateQueries({ queryKey: ['assignmentHubs'] })
      queryClient.invalidateQueries({ queryKey: ['hubs'] })
      queryClient.invalidateQueries({ queryKey: ['assignments'] })
      onSaved(); onClose()
    } catch(e:any){
      const data = e.response?.data
      const detail = data?.details ? `: ${Array.isArray(data.details) ? data.details.map((d:any)=> d.message || d.path?.join('.')).join(', ') : JSON.stringify(data.details)}` : (data?.detail ? ` ${data.detail}` : '')
      const msg = data?.error ? `${data.error}${detail}` : (e.message || 'Failed to save')
      toast.error(msg)
      console.error('Save assignment failed', data || e)
    } finally { setSaving(false) }
  }

  const removeFile = (idx:number)=> setFiles(p=> p.filter((_,i)=> i!==idx))

  return (
    <Modal open={open} onClose={()=> { if(saving) return; onClose() }} title={hub?'Edit Assignment':'Create New Assignment'} size="lg">
      <div className="space-y-6">
        {/* Helper intro */}
        <div className="flex gap-3 p-3 rounded-xl bg-primary-50 dark:bg-primary-900/15 border border-primary-200 dark:border-primary-800">
          <Info size={18} className="text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" />
          <p className="text-xs leading-relaxed text-primary-900 dark:text-primary-100">
            <span className="font-semibold">Fill in the details below.</span> Students will see the title, due date and instructions. You can change visibility and resend later.
          </p>
        </div>

        {/* SECTION 1: Basic Details */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-[#111920] flex items-center justify-center"><FileText size={16} className="text-surface-700 dark:text-[#A6B3BE]"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">Basic details</h3>
              <p className="text-xs text-surface-500 dark:text-night-400">What students will see first</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Assignment title <span className="text-danger-500">*</span></label>
            <input
              value={form.title}
              onChange={e=> setForm(p=>({...p, title:e.target.value}))}
              disabled={saving}
              placeholder="e.g. Data Structures — Linked List Implementation"
              className={`w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border rounded-xl text-sm placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:ring-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${errors.title ? 'border-danger-300 focus:border-danger-400 focus:ring-danger-500/20' : 'border-surface-200 dark:border-[#202C35] focus:border-primary-400 focus:ring-primary-500/20'}`}
            />
            {errors.title ? <p className="text-xs text-danger-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12}/>{errors.title}</p> : <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Clear, specific titles get faster submissions. {form.title.length>0 && `${form.title.length} chars`}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Course <span className="text-surface-400 font-normal">(optional)</span></label>
            <input
              value={form.courseId}
              onChange={e=> setForm(p=>({...p, courseId:e.target.value}))}
              disabled={saving}
              placeholder="e.g. CS301 — Data Structures"
              className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Links this assignment to a course code. Leave blank for general assignments.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Instructions / Description</label>
            <textarea
              value={form.description}
              onChange={e=> setForm(p=>({...p, description:e.target.value}))}
              disabled={saving}
              rows={4}
              placeholder="Add instructions, requirements, grading criteria, or links. Example: &#10;• Implement singly linked list with insert/delete&#10;• Submit .java file or PDF&#10;• See attached rubric"
              className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Supports plain text and links. {form.description.length} / 2000</p>
          </div>
        </section>

        {/* SECTION 2: Timing & Points */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center"><Calendar size={16} className="text-amber-700 dark:text-amber-400"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">Due date & grading</h3>
              <p className="text-xs text-surface-500 dark:text-night-400">When it’s due and how many points it’s worth</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5">Due date <span className="text-danger-500">*</span></label>
              <input type="date" value={form.dueDate} disabled={saving} onChange={e=> setForm(p=>({...p, dueDate:e.target.value}))} className={`w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border rounded-xl text-sm focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${errors.dueDate ? 'border-danger-300 focus:border-danger-400 focus:ring-danger-500/20' : 'border-surface-200 dark:border-[#202C35] focus:border-primary-400 focus:ring-primary-500/20'}`} />
              {errors.dueDate ? <p className="text-xs text-danger-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12}/>{errors.dueDate}</p> : duePreview ? <p className={`text-xs mt-1.5 flex items-center gap-1 ${duePreview.tone==='danger'?'text-danger-600':duePreview.tone==='warning'?'text-amber-600':'text-emerald-600'}`}><Clock size={12}/>{duePreview.text}</p> : <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Students get reminders before the due date.</p>}
            </div>
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-[#A6B3BE] mb-1.5 flex items-center gap-1.5"><Award size={14}/> Max points <span className="text-danger-500">*</span></label>
              <input type="number" min={1} value={form.maxPoints} disabled={saving} onChange={e=> setForm(p=>({...p, maxPoints: parseInt(e.target.value)||0}))} placeholder="100" className={`w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border rounded-xl text-sm focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${errors.maxPoints ? 'border-danger-300 focus:border-danger-400 focus:ring-danger-500/20' : 'border-surface-200 dark:border-[#202C35] focus:border-primary-400 focus:ring-primary-500/20'}`} />
              {errors.maxPoints ? <p className="text-xs text-danger-600 mt-1.5 flex items-center gap-1"><AlertCircle size={12}/>{errors.maxPoints}</p> : <p className="text-xs text-surface-500 dark:text-night-400 mt-1.5">Total score for grading (e.g. 100).</p>}
            </div>
          </div>

          <label className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 dark:border-[#202C35] bg-surface-50 dark:bg-[#0D151C] cursor-pointer hover:bg-white dark:hover:bg-[#111920] transition">
            <input type="checkbox" checked={form.allowLateSubmission} onChange={e=> setForm(p=>({...p, allowLateSubmission:e.target.checked}))} className="mt-1 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500" />
            <div>
              <div className="text-sm font-medium text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">Allow late submissions</div>
              <div className="text-xs text-surface-500 dark:text-night-400">If off, students can’t submit after the due date. If on, late work is marked “Late” for you to grade.</div>
            </div>
          </label>
        </section>

        {/* SECTION 3: Who */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center"><Users size={16} className="text-blue-700 dark:text-blue-400"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">Who should receive this?</h3>
              <p className="text-xs text-surface-500 dark:text-night-400">Choose who can see and submit — you can’t change scope after creation without re-creating</p>
            </div>
          </div>
          <ScopeSelector value={form.scope} departmentId={form.departmentId} roomId={form.roomId} onChange={patch=> { setForm(p=>({...p, ...patch})); setErrors(e=> ({...e, scope:''})) }} />
          {errors.scope ? <p className="text-xs text-danger-600 flex items-center gap-1"><AlertCircle size={12}/>{errors.scope}</p> : <p className="text-xs bg-blue-50 dark:bg-blue-900/15 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-lg flex items-start gap-2"><Info size={14} className="shrink-0 mt-0.5"/>{scopePreview}</p>}
        </section>

        {/* SECTION 4: How submit */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center"><UploadCloud size={16} className="text-emerald-700 dark:text-emerald-400"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">How should students submit?</h3>
              <p className="text-xs text-surface-500 dark:text-night-400">Pick the submission method — this tells students what to do</p>
            </div>
          </div>
          <SubmissionModeToggle value={form.submissionMode} onChange={m=> setForm(p=>({...p, submissionMode:m}))} />
          <p className="text-xs bg-emerald-50 dark:bg-emerald-900/15 text-emerald-700 dark:text-emerald-300 px-3 py-2 rounded-lg flex items-center gap-2"><Info size={14}/> {modePreview}</p>
        </section>

        {/* SECTION 5: Visibility */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center"><Eye size={16} className="text-violet-700 dark:text-violet-400"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">What can students see after submitting?</h3>
              <p className="text-xs text-surface-500 dark:text-night-400">Control feedback visibility — you can change this anytime, even after grading</p>
            </div>
          </div>
          <VisibilityToggles values={{ showGrades: form.showGrades, showFeedback: form.showFeedback, showSubmissionStatus: form.showSubmissionStatus, showStats: form.showStats }} onChange={patch=> setForm(p=>({...p, ...patch}))} />
          <p className="text-xs bg-violet-50 dark:bg-violet-900/15 text-violet-700 dark:text-violet-300 px-3 py-2 rounded-lg">{visibilitySummary}</p>
        </section>

        {/* SECTION 6: Attachments */}
        <section className="rounded-xl border border-surface-200 dark:border-[#202C35] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-[#111920] flex items-center justify-center"><Paperclip size={16} className="text-surface-700 dark:text-[#A6B3BE]"/></span>
            <div>
              <h3 className="text-sm font-bold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">Attachments <span className="font-normal text-surface-500">(optional)</span></h3>
              <p className="text-xs text-surface-500 dark:text-night-400">Add question PDF, rubric, or reference files — up to 5 files</p>
            </div>
          </div>
          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-surface-200 dark:border-[#202C35] rounded-xl bg-surface-50 dark:bg-[#0D151C] hover:bg-white dark:hover:bg-[#111920] cursor-pointer transition group">
            <span className="w-10 h-10 rounded-full bg-white dark:bg-[#1A242E] border border-surface-200 dark:border-[#202C35] flex items-center justify-center group-hover:border-primary-300 transition"><UploadCloud size={18} className="text-surface-500 dark:text-night-400 group-hover:text-primary-600"/></span>
            <span className="text-sm font-medium text-surface-700 dark:text-[#F4F7F8]">Click to upload or drag and drop</span>
            <span className="text-xs text-surface-500 dark:text-night-400">PDF, DOC, images — max 10MB each, 5 files</span>
            <input type="file" multiple onChange={e=> setFiles(Array.from(e.target.files||[]).slice(0,5))} className="hidden" />
          </label>
          {files.length>0 && (
            <div className="space-y-2">
              {files.map((f, i)=> (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-surface-200 dark:border-[#202C35] bg-white dark:bg-[#111920]">
                  <span className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center shrink-0"><File size={14} className="text-primary-600"/></span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-surface-900 dark:text-night-50 dark:text-[#F4F7F8]">{f.name}</div>
                    <div className="text-xs text-surface-500 dark:text-night-400">{(f.size/1024).toFixed(1)} KB</div>
                  </div>
                  <button onClick={()=> removeFile(i)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-[#202C35] text-surface-500 dark:text-night-400 hover:text-danger-600 transition"><X size={16}/></button>
                </div>
              ))}
              <p className="text-xs text-surface-500 dark:text-night-400">{files.length}/5 files selected — they’ll be visible to all recipients.</p>
            </div>
          )}
        </section>

        {/* LIVE PREVIEW */}
        <div className="rounded-xl border border-primary-200 dark:border-primary-800 bg-primary-50/60 dark:bg-primary-900/10 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold tracking-wide uppercase text-primary-700 dark:text-primary-300"><Eye size={14}/> Live preview — what students will see</div>
          <div className="bg-white dark:bg-[#111920] rounded-lg border border-surface-200 dark:border-[#202C35] p-3 space-y-1.5">
            <div className="font-semibold text-surface-900 dark:text-night-50 dark:text-[#F4F7F8] text-sm leading-tight">{form.title || 'Untitled assignment'}</div>
            {form.courseId && <div className="text-xs text-surface-500 dark:text-night-400">{form.courseId}</div>}
            {form.description && <div className="text-xs text-surface-600 dark:text-[#A6B3BE] line-clamp-2 whitespace-pre-wrap">{form.description.slice(0,120)}{form.description.length>120?'…':''}</div>}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-surface-100 dark:bg-[#0D151C] text-surface-700 dark:text-[#A6B3BE] border border-surface-200 dark:border-[#202C35]">{form.scope==='ALL'?'Everyone':form.scope==='DEPARTMENT'?'Department':'Classroom'} • {form.submissionMode.toLowerCase()}</span>
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border border-amber-200 dark:border-amber-800">{duePreview?.text || 'No due date yet'} • {form.maxPoints} pts</span>
              {form.allowLateSubmission && <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-200">Late allowed</span>}
            </div>
            <div className="text-xs text-surface-500 dark:text-night-400 pt-1">{visibilitySummary}</div>
          </div>
          <p className="text-xs text-primary-700/80 dark:text-primary-300/80">This is exactly how it will appear in the student Assignments list.</p>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving} className="flex-1">Cancel</Button>
          <Button onClick={handleSave} loading={saving} disabled={saving} className="flex-1">{saving?'Saving…':hub?'Update assignment':'Create assignment'}</Button>
        </div>
      </div>
    </Modal>
  )
}

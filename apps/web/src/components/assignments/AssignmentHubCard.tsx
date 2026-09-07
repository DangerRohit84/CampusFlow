import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { Upload, Building, Layers, Users, EyeOff, Clock, CheckCircle2, Award, AlertTriangle, Hourglass } from 'lucide-react'

export default function AssignmentHubCard({ hub, onClick, onEdit, onDelete }: any) {
  const daysUntil = (d:string)=> { const diff=Math.ceil((new Date(d).getTime()-Date.now())/(86400000)); if(diff<0) return 'Overdue'; if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow'; return `${diff} days` }
  const due = daysUntil(hub.dueDate)
  const dueTone = due==='Overdue'?'text-danger-600':due==='Today'||due==='Tomorrow'?'text-warning-600':'text-surface-600 dark:text-night-300'
  const scopeLabel = hub.scope==='ALL'?'Everyone':hub.scope==='DEPARTMENT'?'Department':'Classroom'
  const scopePlain = hub.scope==='ALL' ? 'All students' : hub.scope==='DEPARTMENT' ? (hub.department?.name || 'One department') : (hub.room?.name || 'One classroom')
  const scopeColor = hub.scope==='ALL'?'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300 border-primary-200 dark:border-primary-800':hub.scope==='DEPARTMENT'?'bg-warning-50 text-warning-700 dark:bg-warning-900/20 dark:text-warning-300 border-warning-200 dark:border-warning-800':'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300 border-success-200 dark:border-success-800'
  const modeIcon = hub.submissionMode==='ONLINE'?Upload:hub.submissionMode==='OFFLINE'?Building:Layers
  const modePlain = hub.submissionMode==='ONLINE' ? 'Upload online' : hub.submissionMode==='OFFLINE' ? 'Hand in offline' : 'Online or offline'
  const ModeIcon = modeIcon
  const isOverdue = new Date(hub.dueDate) < new Date()
  const cardAccent = isOverdue ? 'rose' as const : 'default' as const
  // student personal status tag
  const mySub = hub.mySubmission
  const hasMySubmissionField = 'mySubmission' in hub
  let submissionTag: any = null
  if (hasMySubmissionField) {
    if (mySub) {
      const status = mySub.status
      // status may be null if teacher hides it via showSubmissionStatus
      if (!status) {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"><CheckCircle2 size={12}/> Submitted</span>
      } else if (status === 'GRADED') {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"><Award size={12}/> Graded {mySub.points != null ? `${mySub.points}/${hub.maxPoints}` : ''}</span>
      } else if (status === 'LATE') {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"><AlertTriangle size={12}/> Late • Submitted</span>
      } else if (status === 'SUBMITTED') {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"><CheckCircle2 size={12}/> Submitted</span>
      } else if (status === 'RETURNED') {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700"><Hourglass size={12}/> Returned</span>
      } else {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-surface-50 text-surface-700 border border-surface-200 dark:bg-night-800 dark:text-night-300 dark:border-night-700">{String(status)}</span>
      }
    } else {
      // not yet submitted
      if (isOverdue) {
        if (hub.allowLateSubmission) submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"><Clock size={12}/> Overdue • Late allowed</span>
        else submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-danger-50 text-danger-700 border border-danger-200 dark:bg-danger-900/30 dark:text-danger-300 dark:border-danger-700"><AlertTriangle size={12}/> Overdue • Not submitted</span>
      } else {
        submissionTag = <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-surface-50 text-surface-600 border border-surface-200 dark:bg-night-800 dark:text-night-400 dark:border-night-700"><Hourglass size={12}/> Pending</span>
      }
    }
  }
  const dueDateTime = (()=> { try { return new Date(hub.dueDate).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit'}) } catch { return String(hub.dueDate).slice(0,16) } })()
  return (
    <Card hover onClick={onClick} accent={cardAccent} className={`group cursor-pointer ${!isOverdue ? 'border border-surface-200/60' : ''}`}>
      <div className="flex gap-4">
        <div className={`w-1 rounded-full shrink-0 ${isOverdue?'bg-danger-500':'bg-surface-200 dark:bg-zinc-700'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-800 dark:text-night-50 dark:text-night-50 group-hover:text-slate-800 dark:group-hover:text-primary-300 leading-tight">{hub.title}</h3>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${scopeColor}`} title={scopePlain}><Users size={10}/>{scopeLabel}</span>
                <span className="inline-flex items-center gap-1 text-xs text-surface-500 dark:text-night-300 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700" title={modePlain}><ModeIcon size={12}/> {modePlain}</span>
                {submissionTag}
              </div>
              <p className="text-xs text-surface-500 dark:text-night-300 mt-1">{hub.courseId ? `Course: ${hub.courseId}` : 'General assignment'} • For: {scopePlain}</p>
              {hub.description && <p className="text-xs text-surface-500 dark:text-night-400 mt-1 line-clamp-1">{hub.description}</p>}
            </div>
            <div className="text-right shrink-0 min-w-[130px]">
              <p className={`text-sm font-bold ${dueTone}`}>{due}</p>
              <p className="text-xs text-surface-400 dark:text-night-400 flex items-center justify-end gap-1"><Clock size={10}/>{dueDateTime}</p>
              <p className="text-xs text-surface-400 dark:text-night-400">{hub.maxPoints ? `${hub.maxPoints} pts` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Badge variant="default">{hub._count?.submissions ?? hub.submissionsCount ?? 0} submissions</Badge>
            <span className="text-xs text-surface-500 dark:text-night-400 flex items-center gap-1"><ModeIcon size={12}/>{hub.submissionMode==='ONLINE'?'Online':hub.submissionMode==='OFFLINE'?'Offline':'Hybrid'}</span>
            {!hub.showGrades && <span className="inline-flex items-center gap-1 text-xs text-surface-400 dark:text-night-400 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700"><EyeOff size={10}/> Grades hidden</span>}
            {!hub.showFeedback && <span className="inline-flex items-center gap-1 text-xs text-surface-400 dark:text-night-400 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700"><EyeOff size={10}/> Feedback hidden</span>}
            {hub.allowLateSubmission && <span className="text-xs px-2 py-0.5 rounded-full bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300 border border-success-200 dark:border-success-800">Late allowed</span>}
            {hasMySubmissionField && mySub?.grade && <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 border border-primary-200 dark:border-primary-700 font-bold">Grade: {mySub.grade}</span>}
          </div>
        </div>
        {(onEdit||onDelete) && <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-start"><button aria-label="Edit assignment" onClick={e=>{e.stopPropagation(); onEdit?.(hub)}} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-night-700 text-surface-500 hover:text-surface-900 dark:text-night-50 dark:bg-[#1e1e1e]">✎</button><button aria-label="Delete assignment" onClick={e=>{e.stopPropagation(); onDelete?.(hub)}} className="p-2 rounded-lg hover:bg-danger-50 text-danger-500">✕</button></div>}
      </div>
    </Card>
  )
}

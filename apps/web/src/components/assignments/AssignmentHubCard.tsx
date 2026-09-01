import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { Upload, Building, Layers, Users, EyeOff } from 'lucide-react'

export default function AssignmentHubCard({ hub, onClick, onEdit, onDelete }: any) {
  const daysUntil = (d:string)=> { const diff=Math.ceil((new Date(d).getTime()-Date.now())/(86400000)); if(diff<0) return 'Overdue'; if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow'; return `${diff} days` }
  const due = daysUntil(hub.dueDate)
  const dueTone = due==='Overdue'?'text-danger-600':due==='Today'||due==='Tomorrow'?'text-amber-600':'text-surface-600 dark:text-night-300'
  const scopeLabel = hub.scope==='ALL'?'Everyone':hub.scope==='DEPARTMENT'?'Department':'Classroom'
  const scopePlain = hub.scope==='ALL' ? 'All students' : hub.scope==='DEPARTMENT' ? (hub.department?.name || 'One department') : (hub.room?.name || 'One classroom')
  const scopeColor = hub.scope==='ALL'?'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border-blue-200 dark:border-blue-800':hub.scope==='DEPARTMENT'?'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 border-amber-200 dark:border-amber-800':'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300 border-purple-200 dark:border-purple-800'
  const modeIcon = hub.submissionMode==='ONLINE'?Upload:hub.submissionMode==='OFFLINE'?Building:Layers
  const modePlain = hub.submissionMode==='ONLINE' ? 'Upload online' : hub.submissionMode==='OFFLINE' ? 'Hand in offline' : 'Online or offline'
  const ModeIcon = modeIcon
  const isOverdue = new Date(hub.dueDate) < new Date()
  const cardAccent = isOverdue ? 'rose' as const : 'default' as const
  return (
    <Card hover onClick={onClick} accent={cardAccent} className={`group cursor-pointer ${!isOverdue ? 'border border-surface-200/60' : ''}`}>
      <div className="flex gap-4">
        <div className={`w-1 rounded-full shrink-0 ${isOverdue?'bg-rose-500':'bg-surface-200 dark:bg-zinc-700'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-800 dark:text-night-50 dark:text-night-50 group-hover:text-slate-800 dark:group-hover:text-primary-300 leading-tight">{hub.title}</h3>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${scopeColor}`} title={scopePlain}><Users size={10}/>{scopeLabel}</span>
                <span className="inline-flex items-center gap-1 text-xs text-surface-500 dark:text-night-300 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700" title={modePlain}><ModeIcon size={12}/> {modePlain}</span>
              </div>
              <p className="text-xs text-surface-500 dark:text-night-300 mt-1">{hub.courseId ? `Course: ${hub.courseId}` : 'General assignment'} • For: {scopePlain}</p>
              {hub.description && <p className="text-xs text-surface-500 dark:text-night-400 mt-1 line-clamp-1">{hub.description}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-bold ${dueTone}`}>{due}</p>
              <p className="text-xs text-surface-400 dark:text-night-400">{new Date(hub.dueDate).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric'})}</p>
              <p className="text-xs text-surface-400 dark:text-night-400">{hub.maxPoints ? `${hub.maxPoints} pts` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <Badge variant="default">{hub._count?.submissions ?? hub.submissionsCount ?? 0} submissions</Badge>
            <span className="text-xs text-surface-500 dark:text-night-400 flex items-center gap-1"><ModeIcon size={12}/>{hub.submissionMode==='ONLINE'?'Online':hub.submissionMode==='OFFLINE'?'Offline':'Hybrid'}</span>
            {!hub.showGrades && <span className="inline-flex items-center gap-1 text-xs text-surface-400 dark:text-night-400 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700"><EyeOff size={10}/> Grades hidden</span>}
            {!hub.showFeedback && <span className="inline-flex items-center gap-1 text-xs text-surface-400 dark:text-night-400 px-2 py-0.5 rounded-full bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700"><EyeOff size={10}/> Feedback hidden</span>}
            {hub.allowLateSubmission && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 border border-blue-200 dark:border-blue-800">Late allowed</span>}
          </div>
        </div>
        {(onEdit||onDelete) && <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity self-start"><button aria-label="Edit assignment" onClick={e=>{e.stopPropagation(); onEdit?.(hub)}} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-night-700 text-surface-500 hover:text-surface-900 dark:text-night-50">✎</button><button aria-label="Delete assignment" onClick={e=>{e.stopPropagation(); onDelete?.(hub)}} className="p-2 rounded-lg hover:bg-danger-50 text-danger-500">✕</button></div>}
      </div>
    </Card>
  )
}

import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { Upload, Building, Layers } from 'lucide-react'

export default function AssignmentHubCard({ hub, onClick, onEdit, onDelete }: any) {
  const daysUntil = (d:string)=> { const diff=Math.ceil((new Date(d).getTime()-Date.now())/(86400000)); if(diff<0) return 'Overdue'; if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow'; return `${diff} days` }
  const due = daysUntil(hub.dueDate)
  const scopeColor = hub.scope==='ALL'?'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400':hub.scope==='DEPARTMENT'?'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400':'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400'
  const modeIcon = hub.submissionMode==='ONLINE'?Upload:hub.submissionMode==='OFFLINE'?Building:Layers
  const ModeIcon = modeIcon
  return (
    <Card hover onClick={onClick} className="group cursor-pointer">
      <div className="flex gap-4">
        <div className={`w-1 rounded-full shrink-0 ${new Date(hub.dueDate)<new Date()?'bg-danger-500':'bg-primary-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div><div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold text-surface-900 dark:text-[#F4F7F8] group-hover:text-primary-700">{hub.title}</h3><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${scopeColor}`}>{hub.scope==='ALL'?'All':hub.scope==='DEPARTMENT'?'Dept':'Room'}</span><span className="flex items-center gap-1 text-xs text-surface-500"><ModeIcon size={12}/> {hub.submissionMode}</span></div><p className="text-sm text-surface-500">{hub.courseId||'General'}</p>{hub.description && <p className="text-xs text-surface-400 mt-1 line-clamp-1">{hub.description}</p>}</div>
            <div className="text-right shrink-0"><p className={`text-sm font-semibold ${due==='Overdue'?'text-danger-600':due==='Today'||due==='Tomorrow'?'text-warning-600':'text-surface-600'}`}>{due}</p><p className="text-xs text-surface-400">{new Date(hub.dueDate).toLocaleDateString()}</p></div>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap"><Badge variant="default">{hub._count?.submissions ?? hub.submissionsCount ?? 0} submissions</Badge>{!hub.showGrades && <span className="text-xs text-surface-400">Grades hidden</span>}{!hub.showFeedback && <span className="text-xs text-surface-400">Feedback hidden</span>}</div>
        </div>
        {(onEdit||onDelete) && <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={e=>{e.stopPropagation(); onEdit?.(hub)}} className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-[#202C35] text-surface-500">✎</button><button onClick={e=>{e.stopPropagation(); onDelete?.(hub)}} className="p-2 rounded-lg hover:bg-danger-50 text-danger-500">✕</button></div>}
      </div>
    </Card>
  )
}

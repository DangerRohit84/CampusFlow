import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { assignmentHubAPI } from '../../lib/api'
import { notifyEntityMutated } from '../../lib/entitySync'
import { getSubmissionChannel, channelBadgeClasses } from '../../lib/assignments'
import toast from 'react-hot-toast'

export default function GradeModal({ submission, hub, open, onClose, onGraded }: any) {
  const [points, setPoints] = useState(submission?.points ?? '')
  const [grade, setGrade] = useState(submission?.grade ?? '')
  const [feedback, setFeedback] = useState(submission?.feedback ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setPoints(submission?.points ?? '')
    setGrade(submission?.grade ?? '')
    setFeedback(submission?.feedback ?? '')
  }, [submission?.id])
  const channel = getSubmissionChannel(submission ?? {})
  const isOffline = channel === 'OFFLINE'
  const handleGrade = async ()=> {
    if (points !== '') {
      const n = Number(points)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > hub.maxPoints) { toast.error(`Points must be integer 0-${hub.maxPoints}`); return }
    }
    setSaving(true)
    try {
      const updated = await assignmentHubAPI.grade(submission.id, { points: points===''?undefined:Number(points), grade: grade||undefined, feedback: feedback||undefined });
      toast.success('Graded');
      notifyEntityMutated('assignment', { hubId: hub?.id, submissionId: submission.id, action: 'graded' });
      // pass enriched submission to parent for optimistic patch — fallback to local merge if API returns minimal
      const enriched = updated?.id ? updated : { ...submission, points: points===''?submission.points:Number(points), grade: grade||submission.grade, feedback: feedback||submission.feedback, status: 'GRADED' }
      if (updated && !enriched.student && submission.student) enriched.student = submission.student
      onGraded(enriched);
      onClose()
    } catch(e:any){ toast.error(e.response?.data?.error||'Failed to grade')} finally{ setSaving(false)}
  }
  return (
    <Modal open={open} onClose={onClose} title={`Grade: ${submission?.student?.name || submission?.studentId}`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2.5 py-1 rounded-full font-bold border ${channelBadgeClasses(isOffline)}`}>{channel}</span>
          {hub?.submissionMode && <span className="px-2 py-1 rounded-full bg-surface-100 dark:bg-night-700 border dark:border-night-600 text-surface-600 dark:text-night-300">Hub: {hub.submissionMode}</span>}
          {submission?.status && <span className="px-2 py-1 rounded-full bg-surface-100 dark:bg-night-700 border dark:border-night-600 text-surface-500 dark:text-zinc-400">{submission.status}</span>}
        </div>
        {submission?.offlineNote && <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-sm"><div className="font-semibold text-amber-800 dark:text-amber-300 text-xs mb-1">Offline note</div><div className="whitespace-pre-wrap text-amber-900 dark:text-amber-100">{submission.offlineNote}</div>{(submission as any).offlineVerifiedAt && <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">Verified {new Date((submission as any).offlineVerifiedAt).toLocaleString()}</div>}</div>}
        {submission?.fileUrl && (()=> {
          let urls:string[]=[]
          let names:string[]=[]
          try{ const p=JSON.parse(submission.fileUrl); if(Array.isArray(p)) urls=p; else urls=[submission.fileUrl] } catch{ urls=[submission.fileUrl] }
          try{ const pn=submission.fileName? JSON.parse(submission.fileName):null; if(Array.isArray(pn)) names=pn; else if(submission.fileName) names=[submission.fileName] } catch{ if(submission.fileName) names=[submission.fileName] }
          if(urls.length!==names.length) names=urls.map((_,i)=> names[i]||`File ${i+1}`)
          return <div className="space-y-1.5">{urls.map((u,i)=> <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary-600 underline"><span className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-night-700 border text-xs">Page {i+1}</span>{names[i]}</a>)} {submission.fileType==='multi' && <span className="text-xs text-surface-500 dark:text-zinc-400">{urls.length} pages</span>}</div>
        })()}
        {submission?.content && <div className="p-3 bg-surface-50 dark:bg-night-800 rounded-xl text-sm whitespace-pre-wrap">{submission.content}</div>}
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-semibold mb-1">Points (max {hub?.maxPoints})</label><Input type="number" value={points} onChange={e=> setPoints(e.target.value)} placeholder="85" /></div>
          <div><label className="block text-sm font-semibold mb-1">Grade</label><Input value={grade} onChange={e=> setGrade(e.target.value)} placeholder="A / 85 / Good" /></div>
        </div>
        <div><label className="block text-sm font-semibold mb-1">Feedback</label><textarea value={feedback} onChange={e=> setFeedback(e.target.value)} rows={4} className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm" placeholder="Well structured..." /></div>
        <div className="flex gap-3"><Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button onClick={handleGrade} disabled={saving} className="flex-1">{saving?'Saving...':'Save Grade'}</Button></div>
      </div>
    </Modal>
  )
}
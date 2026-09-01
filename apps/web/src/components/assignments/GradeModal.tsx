import { useState } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

export default function GradeModal({ submission, hub, open, onClose, onGraded }: any) {
  const [points, setPoints] = useState(submission?.points ?? '')
  const [grade, setGrade] = useState(submission?.grade ?? '')
  const [feedback, setFeedback] = useState(submission?.feedback ?? '')
  const [saving, setSaving] = useState(false)
  const handleGrade = async ()=> {
    if(points!=='' && (Number(points)<0 || Number(points)>hub.maxPoints)) { toast.error(`Points must be 0-${hub.maxPoints}`); return }
    setSaving(true)
    try { await assignmentHubAPI.grade(submission.id, { points: points===''?undefined:Number(points), grade: grade||undefined, feedback: feedback||undefined }); toast.success('Graded'); onGraded(); onClose() } catch(e:any){ toast.error(e.response?.data?.error||'Failed to grade')} finally{ setSaving(false)}
  }
  return (
    <Modal open={open} onClose={onClose} title={`Grade: ${submission?.student?.name || submission?.studentId}`}>
      <div className="space-y-4">
        {submission?.fileUrl && <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="text-sm text-primary-600 underline">View submitted file: {submission.fileName}</a>}
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
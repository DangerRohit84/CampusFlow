import { useState } from 'react'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { assignmentHubAPI } from '../../lib/api'
import toast from 'react-hot-toast'

export default function SubmissionPanel({ hub, submission, onSubmitted }: any) {
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File| null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isLate = new Date() > new Date(hub.dueDate) && !hub.allowLateSubmission
  const canSubmit = hub.submissionMode==='ONLINE' ? (!!content || !!file) : hub.submissionMode==='OFFLINE' ? !!content : (!!content || !!file)
  const handleSubmit = async ()=> {
    if(isLate) { toast.error('Past due and late not allowed'); return }
    if(!canSubmit) { toast.error(hub.submissionMode==='ONLINE'?'Add text or file':'Add confirmation text'); return }
    setSubmitting(true)
    try { await assignmentHubAPI.submit(hub.id, { content: content||undefined, file: file||undefined }); toast.success('Submitted'); onSubmitted() } catch(e:any){ toast.error(e.response?.data?.error||'Submit failed')} finally{ setSubmitting(false)}
  }
  const visibleGrade = hub.showGrades ? submission?.grade : null
  const visiblePoints = hub.showGrades ? submission?.points : null
  const visibleFeedback = hub.showFeedback ? submission?.feedback : null
  const visibleStatus = hub.showSubmissionStatus ? submission?.status : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold text-surface-900 dark:text-[#F4F7F8]">Submission</h3>{visibleStatus && <Badge variant={visibleStatus==='GRADED'?'success':visibleStatus==='LATE'?'danger':'primary'}>{visibleStatus}</Badge>}</div>
      {submission && (
        <div className="p-3 bg-surface-50 dark:bg-[#0D151C] rounded-xl text-sm space-y-2">
          <div>Submitted: {new Date(submission.submittedAt).toLocaleString()}</div>
          {submission.fileUrl && <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 underline">{submission.fileName}</a>}
          {visiblePoints !== null && <div>Grade: {visibleGrade} {visiblePoints !== null && `(${visiblePoints}/${hub.maxPoints})`}</div>}
          {visibleFeedback && <div className="p-2 bg-white dark:bg-[#111920] rounded-lg border">Feedback: {visibleFeedback}</div>}
          {!hub.showGrades && submission.grade && <div className="text-xs text-surface-500">Grade hidden by teacher</div>}
          {!hub.showFeedback && submission.feedback && <div className="text-xs text-surface-500">Feedback hidden</div>}
        </div>
      )}
      {!submission && isLate && <div className="p-3 bg-danger-50 dark:bg-danger-900/20 rounded-xl text-sm text-danger-700">Past due — late submissions not allowed</div>}
      {!submission && !isLate && (
        <div className="space-y-3">
          {hub.submissionMode==='OFFLINE' && <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-xl text-sm">Offline mode: submit in person. Enter confirmation text (e.g., receipt number or declaration).</div>}
          <textarea value={content} onChange={e=> setContent(e.target.value)} rows={4} placeholder={hub.submissionMode==='OFFLINE'?'Confirmation text...':'Write your submission...'} className="w-full px-4 py-3 bg-surface-50 dark:bg-[#0D151C] border border-surface-200 dark:border-[#202C35] rounded-xl text-sm" />
          {(hub.submissionMode==='ONLINE' || hub.submissionMode==='HYBRID') && <input type="file" onChange={e=> setFile(e.target.files?.[0]||null)} className="w-full text-sm" />}
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit} className="w-full">{submitting?'Submitting...':'Submit'}</Button>
        </div>
      )}
    </div>
  )
}

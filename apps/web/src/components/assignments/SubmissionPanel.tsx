import { useState } from 'react'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import { assignmentHubAPI } from '../../lib/api'
import { notifyEntityMutated } from '../../lib/entitySync'
import toast from 'react-hot-toast'
import { File as FileIcon, X, UploadCloud } from 'lucide-react'

export default function SubmissionPanel({ hub, submission, onSubmitted, onClose }: any) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const isLate = new Date() > new Date(hub.dueDate) && !hub.allowLateSubmission
  const canSubmit = hub.submissionMode==='ONLINE' ? (!!content || files.length>0) : hub.submissionMode==='OFFLINE' ? !!content : (!!content || files.length>0)
  const handleSubmit = async ()=> {
    if(isLate) { toast.error('Past due and late not allowed'); return }
    if(!canSubmit) { toast.error(hub.submissionMode==='ONLINE'?'Add text or file':'Add confirmation text'); return }
    if (files.length>5) { toast.error('Max 5 files'); return }
    setSubmitting(true)
    try {
      await assignmentHubAPI.submit(hub.id, { content: content||undefined, files: files.length? files: undefined });
      toast.success('Submitted');
      setContent(''); setFiles([])
      notifyEntityMutated('assignment', { hubId: hub.id, action: 'submitted' })
      if (onClose) onClose()
      if (onSubmitted) onSubmitted()
    } catch(e:any){
      // Upload-audit-all: honest errors — backend reason first (scan/size/type),
      // timeout hint for aborted multipart (60s budget), generic last.
      const backendMsg = e?.response?.data?.error
      if (backendMsg) toast.error(String(backendMsg))
      else {
        const msg = String(e?.message || '')
        const isTimeout = e?.code === 'ECONNABORTED' || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('exceeded')
        toast.error(isTimeout ? 'Submit timed out — large files take up to 60s, please retry' : 'Submit failed')
      }
    } finally{ setSubmitting(false)}
  }
  const visibleGrade = hub.showGrades ? submission?.grade : null
  const visiblePoints = hub.showGrades ? submission?.points : null
  const visibleFeedback = hub.showFeedback ? submission?.feedback : null
  const visibleStatus = hub.showSubmissionStatus ? submission?.status : null

  // Helper to render file links for existing submission (supports multi-file JSON stored)
  const renderSubmissionFiles = () => {
    if (!submission?.fileUrl) return null
    let urls: string[] = []
    let names: string[] = []
    try {
      const parsed = JSON.parse(submission.fileUrl)
      if (Array.isArray(parsed)) urls = parsed
      else urls = [submission.fileUrl]
    } catch { urls = [submission.fileUrl] }
    try {
      const parsedName = submission.fileName ? JSON.parse(submission.fileName) : null
      if (Array.isArray(parsedName)) names = parsedName
      else if (submission.fileName) names = [submission.fileName]
    } catch { if (submission.fileName) names = [submission.fileName] }
    // fallback sync length
    if (urls.length !== names.length) {
      names = urls.map((_,i)=> names[i] || `File ${i+1}`)
    }
    return (
      <div className="space-y-1.5">
        {urls.map((u, i)=> (
          <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary-600 underline text-sm">
            <FileIcon size={14} /> {names[i] || `File ${i+1}`}
          </a>
        ))}
        {submission.fileType==='multi' && <span className="text-xs text-surface-500 dark:text-zinc-400">{urls.length} pages/files</span>}
      </div>
    )
  }

  const removeFile = (idx: number) => setFiles(p=> p.filter((_,i)=> i!==idx))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold text-surface-900 dark:text-night-50 dark:text-night-50">Submission</h3>{visibleStatus && <Badge variant={visibleStatus==='GRADED'?'success':visibleStatus==='LATE'?'danger':'primary'}>{visibleStatus}</Badge>}</div>
      {submission && (
        <div className="p-3 bg-surface-50 dark:bg-night-800 rounded-xl text-sm space-y-2">
          <div>Submitted: {new Date(submission.submittedAt).toLocaleString()}</div>
          {renderSubmissionFiles()}
          {visiblePoints !== null && <div>Grade: {visibleGrade} {visiblePoints !== null && `(${visiblePoints}/${hub.maxPoints})`}</div>}
          {visibleFeedback && <div className="p-2 bg-white dark:bg-night-800 rounded-lg border">Feedback: {visibleFeedback}</div>}
          {!hub.showGrades && submission.grade && <div className="text-xs text-surface-500 dark:text-night-400">Grade hidden by teacher</div>}
          {!hub.showFeedback && submission.feedback && <div className="text-xs text-surface-500 dark:text-night-400">Feedback hidden</div>}
        </div>
      )}
      {!submission && isLate && <div className="p-3 bg-danger-50 dark:bg-danger-900/20 rounded-xl text-sm text-danger-700">Past due — late submissions not allowed</div>}
      {!submission && !isLate && (
        <div className="space-y-3">
          {hub.submissionMode==='OFFLINE' && <div className="p-3 bg-warning-50 dark:bg-warning-900/20 rounded-xl text-sm">Offline mode: submit in person. Enter confirmation text (e.g., receipt number or declaration).</div>}
          <textarea value={content} onChange={e=> setContent(e.target.value)} rows={4} placeholder={hub.submissionMode==='OFFLINE'?'Confirmation text...':'Write your submission...'} disabled={submitting} className="w-full px-4 py-3 bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-700 rounded-xl text-sm disabled:opacity-50 disabled:cursor-not-allowed" />
          {(hub.submissionMode==='ONLINE' || hub.submissionMode==='HYBRID') && (
            <div className="space-y-2">
              <label className="flex flex-col items-center justify-center gap-2 p-4 border-2 border-dashed border-surface-200 dark:border-night-700 rounded-xl bg-surface-50 dark:bg-night-800 hover:bg-white dark:hover:bg-night-800 cursor-pointer transition group">
                <span className="w-8 h-8 rounded-full bg-white dark:bg-night-700 border border-surface-200 dark:border-night-700 flex items-center justify-center group-hover:border-primary-300 transition"><UploadCloud size={16} className="text-surface-500 group-hover:text-primary-600 dark:text-zinc-400"/></span>
                <span className="text-sm font-medium text-surface-700 dark:text-night-50">Click to upload pages/files</span>
                <span className="text-xs text-surface-500 dark:text-night-400">PDF, images, docs — up to 5 files, 10MB each. For multi-page assignments upload each page.</span>
                <input type="file" multiple accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt,.zip" onChange={e=> setFiles(Array.from(e.target.files||[]).slice(0,5))} disabled={submitting} className="hidden" />
              </label>
              {files.length>0 && (
                <div className="space-y-1.5">
                  {files.map((f,i)=> (
                    <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-surface-200 dark:border-night-700 bg-white dark:bg-night-800">
                      <span className="w-7 h-7 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center shrink-0"><FileIcon size={13} className="text-primary-600"/></span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className="text-xs text-surface-500 dark:text-zinc-400">{(f.size/1024).toFixed(1)} KB</div>
                      </div>
                      <button onClick={()=> removeFile(i)} disabled={submitting} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-night-700 text-surface-500 hover:text-danger-600 transition dark:text-zinc-400 dark:bg-[#1e1e1e]"><X size={14}/></button>
                    </div>
                  ))}
                  <p className="text-xs text-surface-500 dark:text-night-400">{files.length}/5 files selected — each page counts, you can remove before submit.</p>
                </div>
              )}
            </div>
          )}
          <Button onClick={handleSubmit} loading={submitting} disabled={submitting || !canSubmit} className="w-full">{submitting?'Submitting...':'Submit'}</Button>
        </div>
      )}
    </div>
  )
}

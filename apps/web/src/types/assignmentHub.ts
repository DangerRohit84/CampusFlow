export type AssignmentScope = 'ALL' | 'DEPARTMENT' | 'ROOM'
export type SubmissionMode = 'ONLINE' | 'OFFLINE' | 'HYBRID'
export interface AssignmentHub {
  id: string
  title: string
  description: string | null
  courseId: string | null
  dueDate: string
  creatorId: string
  collegeId: string | null
  scope: AssignmentScope
  departmentId: string | null
  roomId: string | null
  submissionMode: SubmissionMode
  showGrades: boolean
  showFeedback: boolean
  showSubmissionStatus: boolean
  showStats: boolean
  maxPoints: number
  maxGrade: string | null
  allowLateSubmission: boolean
  attachments: string
  createdAt: string
  updatedAt: string
  creator?: { id: string; name: string }
  department?: { id: string; name: string } | null
  room?: { id: string; name: string } | null
  _count?: { submissions: number }
  submissionsCount?: number
  mySubmission?: AssignmentSubmission | null
}
export interface AssignmentSubmission {
  id: string
  assignmentId: string
  studentId: string
  content: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  fileSize: number | null
  status: string | null
  grade: string | null
  points: number | null
  feedback: string | null
  submittedAt: string
  gradedAt: string | null
  student?: { id: string; name: string; email: string; studentId: string }
}

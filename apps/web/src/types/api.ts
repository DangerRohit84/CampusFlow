export interface User {
  id: string
  name: string
  email: string
  role: 'STUDENT' | 'TEACHER' | 'COLLEGE_ADMIN' | 'SUPER_ADMIN'
  departmentId?: string
  departmentName?: string
  department?: Department
  collegeId?: string
  college?: College
  incomingYear?: number
  outgoingYear?: number
  empNumber?: string
  studentId?: string
  avatarUrl?: string
}

export interface Department {
  id: string
  name: string
  collegeId: string
  college?: College
}

export interface College {
  id: string
  name: string
  code: string
  description?: string
  domain?: string
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'
}

export interface Hackathon {
  id: string
  name: string
  description?: string
  url: string
  startDate?: string
  endDate?: string
  deadline?: string
  prizePool?: string
  location?: string
  teamSize?: number
  registrationFee?: string
  tags?: string
  image?: string
  status: 'UPCOMING' | 'ONGOING' | 'COMPLETED'
  aiExtracted?: boolean
  aiConfidence?: number
  extractedAt?: string
  sourceText?: string
  targetDepartments?: string[]
  targetYears?: number[]
  eligibilityEnabled?: boolean
  creator?: User
  registrations?: HackathonRegistration[]
  rounds?: HackathonRound[]
  _count?: { registrations: number }
}

export interface HackathonRegistration {
  id: string
  hackathonId: string
  studentId: string
  student?: User
  hackathon?: Hackathon
  registeredAt?: string
  status: 'REGISTERED' | 'ELIMINATED' | 'ADVANCED' | 'WINNER'
  selfReported?: boolean
  selfReportUrl?: string
  selfReportedAt?: string
  currentRound?: string
  roundsCompleted?: number
  totalPrize?: number
  teamMembers?: string
}

export interface HackathonRound {
  id: string
  hackathonId: string
  name: string
  order: number
  date?: string
  resultDate?: string
  description?: string
  hackathon?: Hackathon
}

export interface Form {
  id: string
  title: string
  description?: string
  teacherId: string
  teacher?: User
  deadline?: string
  duration?: number
  isPublished: boolean
  isExpired: boolean
  allowEdit: boolean
  targetDepartments?: string[]
  targetYears?: number[]
  eligibilityEnabled?: boolean
  fields?: FormField[]
  responses?: FormResponse[]
  rooms?: FormRoom[]
  _count?: { responses: number }
}

export interface FormField {
  id: string
  formId: string
  type: 'SHORT_ANSWER' | 'LONG_ANSWER' | 'MULTIPLE_CHOICE' | 'CHECKBOX' | 'FILE'
  label: string
  required: boolean
  order: number
  options?: string
  form?: Form
}

export interface FormResponse {
  id: string
  formId: string
  studentId: string
  student?: User
  form?: Form
  submittedAt?: string
  answers?: FormAnswer[]
}

export interface FormAnswer {
  id: string
  responseId: string
  fieldId: string
  value: string
  response?: FormResponse
  field?: FormField
}

export interface FormRoom {
  id: string
  formId: string
  roomId: string
  form?: Form
  room?: Room
}

export interface Room {
  id: string
  name: string
  description?: string
  teacherId: string
  joinCode: string
  teacher?: User
  members?: RoomMember[]
  resources?: Resource[]
  _count?: { members: number; resources: number }
}

export interface RoomMember {
  id: string
  roomId: string
  studentId: string
  isCR: boolean
  joinedAt?: string
  room?: Room
  student?: User
}

export interface Resource {
  id: string
  roomId: string
  uploaderId: string
  name: string
  originalName: string
  mimeType: string
  size: number
  category: 'LECTURE' | 'ASSIGNMENT' | 'REFERENCE' | 'OTHER'
  description?: string
  uploader?: User
  room?: Room
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'CR_APPOINTED' | 'CR_REMOVED' | 'RESOURCE_UPLOADED' | 'ROOM_JOINED' | 'ROOM_LEFT' | 'FORM_LINKED' | 'GENERAL'
  read: boolean
  roomId: string
  userId?: string
  room?: Room
  createdAt?: string
}

export interface DashboardData {
  stats: {
    totalHackathons: number
    hackathonRegistrations: number
    activeForms: number
    formResponses: number
    unreadNotifications: number
    pendingApprovals?: number
  }
  recentActivity: Array<{
    type: 'hackathon' | 'form' | 'notification'
    title: string
    description?: string
    time: string
  }>
  upcomingDeadlines?: Array<{
    type: 'hackathon' | 'form'
    title: string
    deadline: string
    id: string
  }>
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  model: string
  provider: string
  createdAt: string
}

export interface ChatProvider {
  id: string
  name: string
  models: string[]
}

export interface AiProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  type: string
  headers: string | null
  enabled: boolean
  isBuiltIn: boolean
  collegeId: string | null
  createdAt: string
  updatedAt: string
}

export interface AiRouting {
  id: string
  feature: string
  providerId: string
  fallbackOrder: number
  collegeId: string | null
}
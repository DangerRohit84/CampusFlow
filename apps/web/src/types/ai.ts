// types/ai.ts — dashboard + chat + AI provider contracts (ISP split from api.ts).
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

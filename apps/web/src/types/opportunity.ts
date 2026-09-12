// types/opportunity.ts — hackathon cards vs details (ISP split from api.ts).
// WHY: list pages need HackathonCard (id/title/deadline/prize) but got the full
// 26-field Hackathon (+ _count/regs/rounds). Narrow DTOs below; full Hackathon
// kept for detail pages. Shapes verbatim; mappers in ./opportunityMappers.ts
// (companion). No behavior change.
import type { User } from './user'

/** List card (narrow — use in tables/cards, not detail). */
export interface HackathonCard {
  id: string
  name: string
  url: string
  deadline?: string
  prizePool?: string
  location?: string
  status: 'UPCOMING' | 'ONGOING' | 'COMPLETED'
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

/** Detail = card + relations (use only in detail pages). */
export type HackathonDetail = Hackathon

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

/** Narrow a full Hackathon to its card (pure, tested). */
export function toHackathonCard(h: Hackathon): HackathonCard {
  return {
    id: h.id,
    name: h.name,
    url: h.url,
    deadline: h.deadline,
    prizePool: h.prizePool,
    location: h.location,
    status: h.status,
  }
}

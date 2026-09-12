// types/form.ts — forms + fields + responses (ISP split from api.ts).
import type { User } from './user'
import type { Room } from './room'

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

// types/college.ts — college + department (ISP split from api.ts).
// WHY: AdminPage needs counts, HackathonsPage needs cards — same fat import
// pulled both. Focused file = narrow contract. Shapes verbatim.
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

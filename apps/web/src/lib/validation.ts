// lib/validation.ts — pure form validators (topbottom F1/F6/F9).
// WHY: Insights subjects, CollegeRegistration, AddStudent/AddTeacher email
// checks were inline/ad-hoc (or missing) — untestable in node vitest.
// Pure fns here lock behavior; pages import them (no logic duplication).
export function isValidEmail(email: unknown): boolean {
  if (typeof email !== 'string') return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** Split comma-separated subjects, trim, drop empties. */
export function parseSubjects(input: unknown): string[] {
  if (typeof input !== 'string') return []
  return input.split(',').map((s) => s.trim()).filter(Boolean)
}

export type CollegeRegForm = {
  collegeName: string
  collegeCode: string
  address?: string
  phone?: string
  website?: string
  adminName: string
  adminEmail: string
  adminPassword: string
}

/** College registration validation — required + format (topbottom F6). */
export function validateCollegeRegistration(form: CollegeRegForm): Record<string, string> {
  const e: Record<string, string> = {}
  if (!form.collegeName.trim()) e.collegeName = 'College name is required.'
  else if (form.collegeName.trim().length < 3) e.collegeName = 'College name must be at least 3 characters.'
  if (!form.collegeCode.trim()) e.collegeCode = 'College code is required.'
  else if (!/^[A-Za-z0-9-]{2,12}$/.test(form.collegeCode.trim()))
    e.collegeCode = 'Code must be 2–12 letters/numbers/dashes.'
  if (!form.adminName.trim()) e.adminName = 'Your name is required.'
  else if (form.adminName.trim().length < 2) e.adminName = 'Enter at least 2 characters.'
  if (!form.adminEmail.trim()) e.adminEmail = 'Admin email is required.'
  else if (!isValidEmail(form.adminEmail)) e.adminEmail = 'Enter a valid email.'
  if (!form.adminPassword) e.adminPassword = 'Password is required.'
  else if (form.adminPassword.length < 8) e.adminPassword = 'Minimum 8 characters.'
  else if (form.adminPassword.length > 72) e.adminPassword = 'Maximum 72 characters.'
  return e
}

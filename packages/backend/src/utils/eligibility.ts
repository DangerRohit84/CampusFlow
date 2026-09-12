import prisma from '../config/db'

/**
 * AI department-code → departmentId resolution (popular-site parity).
 *
 * The enrichment pipeline (opportunityAgent) stores AI-inferred codes such as
 * ["CSE","IT","AIDS"] or ["ALL"] in `targetDepartments` (canonical Json array;
 * pre-Order-3 rows were JSON strings — normalizers accept both), while
 * manually-created records store real `departmentId` UUIDs. Direct
 * `targetDepts.includes(user.departmentId)` checks therefore reject every
 * student for AI-enriched records.
 *
 * This helper accepts the mixed array and returns true when the user is
 * eligible. Rules:
 * - empty array → open to all (eligible)
 * - contains "ALL" (case-insensitive) → eligible
 * - contains the user's raw departmentId → eligible
 * - contains an AI code that maps to the user's department (via abbrev map
 *   + name-contains fallback against the college's departments) → eligible
 */

// Mirrors apps/web/src/lib/api.ts DEPT_ABBREV_MAP + opportunityAgent code list.
const AI_CODE_TO_NAME_HINT: Record<string, string> = {
  CSE: 'computer',
  CS: 'computer',
  'COMPUTER SCIENCE': 'computer',
  IT: 'information tech',
  'INFORMATION TECHNOLOGY': 'information tech',
  ISE: 'information sc',
  'INFORMATION SCIENCE': 'information sc',
  ECE: 'electronics',
  ELECTRONICS: 'electronics',
  EEE: 'electrical',
  ELECTRICAL: 'electrical',
  EE: 'electrical',
  MECH: 'mechanical',
  ME: 'mechanical',
  MECHANICAL: 'mechanical',
  AUTO: 'automobile',
  CIVIL: 'civil',
  ARCH: 'architect',
  EIE: 'instrumentation',
  INSTRUMENTATION: 'instrumentation',
  AIDS: 'artificial',
  AIML: 'artificial',
  CSBS: 'computer',
  CYS: 'cyber',
  DS: 'data',
  MCA: 'computer',
  MBA: 'manag',
  CHEM: 'chemic',
  BT: 'biotech',
  BIO: 'biotech',
  PHARMA: 'pharma',
  IE: 'industrial',
}

function normalizeCode(code: string): string {
  return String(code || '').toUpperCase().trim()
}

export function isCodeEligibleForDepartment(
  code: string,
  userDepartmentId: string | null | undefined,
  collegeDepartments: { id: string; name: string }[],
): boolean {
  if (!userDepartmentId) return false
  const norm = normalizeCode(code)
  if (!norm) return false
  if (norm === 'ALL') return true
  // Direct UUID match (manually-created records)
  if (code === userDepartmentId) return true
  const hint = AI_CODE_TO_NAME_HINT[norm]
  const userDept = collegeDepartments.find((d) => d.id === userDepartmentId)
  const userName = (userDept?.name || '').toUpperCase()
  // Exact code == department name (e.g., both "CSE")
  if (userName === norm) return true
  if (!hint) {
    // Unknown code: fall back to substring against user's dept name
    return userName.includes(norm) || norm.includes(userName)
  }
  // Hint match: user's dept name contains hint (e.g., "Computer Science" contains "computer")
  if (userName.toLowerCase().includes(hint)) return true
  // Also check: any college dept matching the code resolves to user's dept
  const mapped = collegeDepartments.find(
    (d) => d.name.toUpperCase() === norm || d.name.toUpperCase().includes(hint.toUpperCase()) || d.id === code,
  )
  return !!mapped && mapped.id === userDepartmentId
}

export function isDepartmentEligible(
  targetDeptsRaw: string[],
  userDepartmentId: string | null | undefined,
  collegeDepartments: { id: string; name: string }[],
): boolean {
  if (!targetDeptsRaw || targetDeptsRaw.length === 0) return true
  if (targetDeptsRaw.some((c) => normalizeCode(c) === 'ALL')) return true
  // Fast path: direct ID match
  if (userDepartmentId && targetDeptsRaw.includes(userDepartmentId)) return true
  if (!userDepartmentId) return false
  return targetDeptsRaw.some((code) =>
    isCodeEligibleForDepartment(code, userDepartmentId, collegeDepartments),
  )
}

/** Fetch minimal department list for a college (cached per-request by caller). */
export async function getCollegeDepartments(
  collegeId: string | null | undefined,
): Promise<{ id: string; name: string }[]> {
  if (!collegeId) return []
  return prisma.department.findMany({
    where: { collegeId },
    select: { id: true, name: true },
  })
}

/**
 * Resolve mixed AI-code/ID array to concrete departmentIds for a college.
 * - ["ALL"] → all departmentIds of the college
 * - [] → [] (open)
 * - otherwise map each entry: UUIDs pass through, AI codes resolve via hint match
 */
export async function resolveDepartmentIds(
  codesOrIds: string[],
  collegeId: string | null | undefined,
): Promise<string[]> {
  if (!codesOrIds || codesOrIds.length === 0) return []
  if (codesOrIds.some((c) => normalizeCode(c) === 'ALL')) {
    const all = await getCollegeDepartments(collegeId)
    return all.map((d) => d.id)
  }
  const depts = await getCollegeDepartments(collegeId)
  const byId = new Set(depts.map((d) => d.id))
  const out = new Set<string>()
  for (const entry of codesOrIds) {
    if (byId.has(entry)) {
      out.add(entry)
      continue
    }
    const norm = normalizeCode(entry)
    const hint = AI_CODE_TO_NAME_HINT[norm]
    const match = depts.find(
      (d) =>
        d.name.toUpperCase() === norm ||
        (hint && d.name.toLowerCase().includes(hint)),
    )
    if (match) out.add(match.id)
  }
  return [...out]
}

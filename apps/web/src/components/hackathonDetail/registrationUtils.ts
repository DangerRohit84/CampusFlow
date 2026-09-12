// components/hackathonDetail/registrationUtils.ts — pure reg analytics + filters (SRP extract).
// WHY: HackathonDetailPage (1702 lines) mixed data-fetch + filter + modal +
// export + socket in one component. These pure helpers are independently
// testable (no hooks/network). Page keeps hooks (useMemo) but delegates logic
// here; full useHackathonDetail hook adoption is next slice. Behavior identical.

export interface RegUserLike {
  name?: string | null;
  email?: string | null;
  studentId?: string | null;
  departmentId?: string | null;
  department?: { name?: string } | string | null;
  departmentName?: string | null;
  incomingYear?: number | string | null;
}

export interface RegLike {
  user?: RegUserLike | null;
  teamName?: string | null;
  teamMembers?: string | null;
}

export interface DeptLike {
  id: string;
  name: string;
}

export function getRegAvailableYears(registrations: RegLike[] | null | undefined): string[] {
  const s = new Set<string>();
  for (const r of registrations ?? []) {
    const y = r.user?.incomingYear;
    if (y != null && String(y).trim() !== '') s.add(String(y));
  }
  return Array.from(s).sort();
}

function deptLabelOf(r: RegLike): string {
  const u = r.user;
  const key = u?.department && typeof u.department === 'object'
    ? u.department.name
    : (u?.department as string | null | undefined) ?? u?.departmentName ?? 'Unknown';
  const label = typeof key === 'string' && key.trim() ? key.trim() : 'Unknown';
  return label;
}

export function getRegDeptBreakdown(registrations: RegLike[] | null | undefined): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of registrations ?? []) {
    const label = deptLabelOf(r);
    m.set(label, (m.get(label) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export function getRegYearBreakdown(registrations: RegLike[] | null | undefined): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of registrations ?? []) {
    const y = r.user?.incomingYear ? String(r.user.incomingYear) : 'Unknown';
    m.set(y, (m.get(y) || 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export function filterRegs(
  registrations: RegLike[] | null | undefined,
  opts: { term: string; dept: string; year: string; departments: DeptLike[] },
): RegLike[] {
  const term = String(opts.term || '').trim().toLowerCase();
  return (registrations ?? []).filter((r) => {
    if (term) {
      const hay = `${r.user?.name || ''} ${r.user?.email || ''} ${r.user?.studentId || ''} ${r.teamName || ''} ${r.teamMembers || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (opts.dept !== 'ALL') {
      const deptObj = opts.departments.find((d) => d.id === opts.dept);
      const deptName = deptObj?.name;
      const userDeptId = r.user?.departmentId;
      const userDeptName = r.user && typeof r.user.department === 'object'
        ? r.user.department?.name
        : (r.user?.department as string | undefined) ?? r.user?.departmentName;
      if (userDeptId) {
        if (userDeptId !== opts.dept) return false;
      } else if (deptName) {
        if (String(userDeptName).toLowerCase() !== deptName.toLowerCase()) return false;
      } else {
        if (String(userDeptName) !== opts.dept) return false;
      }
    }
    if (opts.year !== 'ALL') {
      if (String(r.user?.incomingYear ?? '') !== opts.year) return false;
    }
    return true;
  });
}

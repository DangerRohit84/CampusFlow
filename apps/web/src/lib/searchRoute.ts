// lib/searchRoute.ts — search result → app route (topbottom F4).
// WHY: SearchPage rendered cursor-pointer cards with NO onClick — dead click
// for all 10 backend types (schedule/assignment/assignmentHub/notification/
// hackathon/internship/form/room/contest/task). Pure map locks navigation;
// unknown types fall back to null (card renders non-clickable, no pointer).
export type SearchResultLike = { type?: unknown; id?: unknown }

export function getSearchResultRoute(r: SearchResultLike | null | undefined): string | null {
  if (!r || typeof r.type !== 'string' || typeof r.id !== 'string' || !r.id) return null
  switch (r.type) {
    case 'schedule':
      return '/schedule'
    case 'assignment':
      return '/assignments'
    case 'assignmentHub':
      return `/assignments/${r.id}`
    case 'notification':
      return '/notifications'
    case 'hackathon':
      return `/hackathons/${r.id}`
    case 'internship':
      return `/internships/${r.id}`
    case 'form':
      return `/forms/${r.id}`
    case 'room':
      return `/rooms/${r.id}`
    case 'contest':
      return '/contests'
    case 'task':
      return '/tasks'
    default:
      return null
  }
}

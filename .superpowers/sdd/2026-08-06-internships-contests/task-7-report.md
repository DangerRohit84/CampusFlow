# Task 7 Report: Frontend — InternshipsPage

**Status:** DONE

## Commit
- `fbf4b00` — feat(frontend): add InternshipsPage with filters, create form, and eligibility popup

## Files Created/Modified
- **Created:** `apps/web/src/pages/InternshipsPage.tsx` (487 lines)
- **Modified:** `apps/web/src/App.tsx` — added import + `/internships` route
- **Modified:** `apps/web/src/components/layout/Layout.tsx` — added Briefcase icon + Internships nav item to all 4 role menus

## Implementation Summary
- Mirrors HackathonsPage structure exactly using shared components: FilterTabs, StatCard, EmptyState, PageHeader, EligibilityPopup
- Uses hooks: useFilteredItems, useModal
- Filter tabs: All / Upcoming / Active / Ended with counts
- Stat cards: Total, Upcoming, Active, Registrations
- Internship cards display: company, role, stipend, duration, mode badge, deadline (with urgency highlight), registration count
- Teacher: "Post Internship" button → create modal with title, company, role, description, URL, stipend, duration, mode, start date, deadline → EligibilityPopup for dept/year targeting
- Student: Click card navigates to detail page (Task 8)
- Delete button (visible on hover) for creators
- Export All button in header
- Status determination: uses deadline + startDate to compute upcoming/active/ended

## Test Summary
- TypeScript compilation passes with zero errors (`tsc --noEmit`)
- No runtime tests run (frontend page)

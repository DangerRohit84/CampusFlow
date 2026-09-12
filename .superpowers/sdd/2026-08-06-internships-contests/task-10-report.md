# Task 10: Sidebar + Dashboard + App Routes — Report

**Status:** DONE
**Commit:** c3399be — feat(frontend): add sidebar nav items and dashboard stats for internships/contests

## What was done

### 1. Sidebar Navigation (Layout.tsx)
- Added `Contests` nav item (with `Code` icon) to all 4 role navs: STUDENT, TEACHER, COLLEGE_ADMIN, SUPER_ADMIN
- Placed after Internships and before Forms, as specified in plan
- Internships nav item was already present from a prior task

### 2. Badge Count Logic (Layout.tsx)
- Extended `nearDeadlineCount` state to include `internships` and `contests`
- Added fetch calls for `internshipAPI.getAll()` and `codingContestAPI.getAll()` to compute near-deadline counts
- Internships badge: count of ACTIVE internships with deadlines within 3 days
- Contests badge: count of UPCOMING contests starting within 3 days
- Updated nav badge rendering to display counts for internships and contests

### 3. Dashboard Stat Cards (DashboardPage.tsx)
- **Student dashboard:** Added 2 new stat cards: "Active Internships" and "My Registrations"
- **Teacher dashboard:** Added 2 new stat cards: "Posted Internships" and "Total Contests"
- Added `useEffect` in `DashboardPage` to fetch internship/contest data and merge into dashboard state
- Updated grid layout from `lg:grid-cols-4` to `lg:grid-cols-3` for balanced display with 6 cards

### 4. App Routes Verification
- All 3 routes already existed in App.tsx from prior tasks:
  - `/internships` → `InternshipsPage` ✓
  - `/internships/:id` → `InternshipDetailPage` ✓
  - `/contests` → `CodingContestsPage` ✓

## Files Modified
- `apps/web/src/components/layout/Layout.tsx` — nav items, badge counts, API imports
- `apps/web/src/pages/DashboardPage.tsx` — stat cards, data fetching, icon/API imports

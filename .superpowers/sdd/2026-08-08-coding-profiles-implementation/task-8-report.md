# Task 8 Report: Frontend Route & Sidebar

**Date:** 2026-08-08  
**Status:** DONE  
**Commit:** `3625ad8` feat: add coding profile route, sidebar nav, and soft gate nudge

## Changes Made

### App.tsx
- Added `import CodingProfilePage from './pages/CodingProfilePage'` (line 21)
- Added route `<Route path="coding-profile" element={<CodingProfilePage />} />` (line 89)

### Layout.tsx
- Added `codingProfileAPI` to the API import (line 13)
- Added `{ path: '/coding-profile', label: 'Coding Profile', icon: Code }` to all four role nav arrays:
  - STUDENT (line 22)
  - TEACHER (line 37)
  - COLLEGE_ADMIN (line 49)
  - SUPER_ADMIN (line 60)
- Added `showProfileNudge` state (line 78)
- Added useEffect to check if student has coding profiles (lines 136-145)
- Added nudge banner JSX after desktop sidebar, before mobile sidebar overlay (lines 269-286)

## Verification
- Both files read and confirmed all edits are in place
- TypeScript import resolution: CodingProfilePage component exists at `apps/web/src/pages/CodingProfilePage.tsx`
- API: `codingProfileAPI` exported from `apps/web/src/lib/api.ts`
- Route is inside the protected Layout route
- Nudge banner only shows for STUDENT role users with no coding profiles configured

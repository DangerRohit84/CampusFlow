# Attendance History Endpoint Design

## Overview
Add two new routes to the existing attendance router:
- `GET /api/attendance/history` – returns grouped attendance records for the authenticated user
- `POST /api/attendance/save` – saves attendance records for the authenticated user

## Routes
### GET /history
- **Middleware:** `authenticate`
- **Input:** None (userId from auth)
- **Output:** `{ history: Array<{ date, type, subjectCount, overallPercentage }> }`
- **Logic:** Fetch last 50 records for the user, group by date, compute summary.

### POST /save
- **Middleware:** `authenticate`
- **Input:** `{ records: Array<{ subject, date, status }>, source?: string }`
- **Output:** `{ saved: number }`
- **Logic:** Validate input, create many records with userId and source (default 'MANUAL').

## Data Model
- Uses existing `AttendanceRecord` Prisma model.
- Fields: id, studentId, subject, date, status, source, createdAt.

## Implementation Details
- Import `prisma` from `../config/db` (singleton).
- Use `prisma.attendanceRecord.findMany` and `prisma.attendanceRecord.createMany`.
- Error handling: try-catch, log error, return 500.

## Testing
- Manual curl with auth token.
- Verify history returns grouped data.
- Verify save creates records.

## Commit
- Single commit: `feat: add attendance history and save endpoints`
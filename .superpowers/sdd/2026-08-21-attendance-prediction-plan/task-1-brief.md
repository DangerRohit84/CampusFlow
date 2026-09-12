# Task 1: Prisma Schema + Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Create: `packages/backend/prisma/migrations/` (auto-generated)

**Interfaces:**
- Produces: `AttendanceRecord` model, `AttendancePrediction` model, `AttendanceStatus` enum, `AttendanceSource` enum

## Steps

1. Add `AttendanceStatus` and `AttendanceSource` enums to schema.prisma:

```prisma
enum AttendanceStatus {
  PRESENT
  ABSENT
  LATE
  EXCUSED
}

enum AttendanceSource {
  UPLOAD
  MANUAL
}
```

2. Add `AttendanceRecord` model:

```prisma
model AttendanceRecord {
  id            String            @id @default(cuid())
  studentId     String
  student       Student           @relation(fields: [studentId], references: [id])
  subject       String
  date          DateTime
  status        AttendanceStatus
  source        AttendanceSource
  createdAt     DateTime          @default(now())

  @@index([studentId, subject])
  @@index([studentId, createdAt])
}
```

3. Add `AttendancePrediction` model:

```prisma
model AttendancePrediction {
  id               String   @id @default(cuid())
  studentId        String
  student          Student  @relation(fields: [studentId], references: [id])
  subject          String
  totalClasses     Int
  presentClasses   Int
  classesPerWeek   Int
  weeksRemaining   Int
  targetPercentage Float    @default(75)
  createdAt        DateTime @default(now())

  @@index([studentId])
}
```

4. Add relation to `Student` model:
```prisma
  attendanceRecords    AttendanceRecord[]
  attendancePredictions AttendancePrediction[]
```

5. Run migration: `cd packages/backend && npx prisma migrate dev --name add-attendance-models`
6. Verify: `cd packages/backend && npx prisma generate`
7. Commit: `git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations && git commit -m "feat: add AttendanceRecord and AttendancePrediction Prisma models"`

**Working directory:** `D:\Alpha Coders\CampusFlow`

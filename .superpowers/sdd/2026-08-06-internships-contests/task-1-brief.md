# Task 1: Prisma Schema + Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`
- Run: `npx prisma db push` (from packages/backend)

**Interfaces:**
- Produces: `Internship`, `InternshipRegistration`, `CodingContest` models

- [ ] **Step 1: Add Internship model to schema.prisma**

Add after the `HackathonRound` model:

```prisma
model Internship {
  id                 String   @id @default(uuid())
  creatorId          String
  collegeId          String
  title              String
  description        String
  company            String
  role               String
  url                String
  stipend            String?
  duration           String?
  mode               String   @default("REMOTE")
  startDate          String?
  deadline           String?
  targetDepartments  String   @default("[]")
  targetYears        String   @default("[]")
  eligibilityEnabled Boolean  @default(false)
  status             String   @default("ACTIVE")
  createdAt          DateTime @default(now())
  creator            User     @relation(fields: [creatorId], references: [id])
  college            College  @relation(fields: [collegeId], references: [id])
  registrations      InternshipRegistration[]
}

model InternshipRegistration {
  id           String     @id @default(uuid())
  internshipId String
  userId       String
  status       String     @default("REGISTERED")
  reportedAt   DateTime?
  internship   Internship @relation(fields: [internshipId], references: [id])
  user         User       @relation(fields: [userId], references: [id])
  @@unique([internshipId, userId])
}

model CodingContest {
  id            String   @id @default(uuid())
  title         String
  platform      String
  url           String
  startTime     String
  duration      Int?
  contestType   String?
  status        String   @default("UPCOMING")
  solutions     String   @default("[]")
  isAutoFetched Boolean  @default(false)
  creatorId     String?
  collegeId     String?
  createdAt     DateTime @default(now())
  creator       User?    @relation(fields: [creatorId], references: [id])
  college       College? @relation(fields: [collegeId], references: [id])
}
```

- [ ] **Step 2: Add relations to User model**

In the `User` model, add:

```prisma
  internships         Internship[]
  internshipRegistrations InternshipRegistration[]
```

- [ ] **Step 3: Add relations to College model**

In the `College` model, add:

```prisma
  internships         Internship[]
  codingContests      CodingContest[]
```

- [ ] **Step 4: Run prisma db push**

Run: `npx prisma db push` from `packages/backend`

Expected: "The database is now in sync with your Prisma schema"

- [ ] **Step 5: Generate Prisma client**

Run: `npx prisma generate` from `packages/backend`

Expected: "Generated Prisma Client"

- [ ] **Step 6: Commit**

```bash
git add packages/backend/prisma/schema.prisma
git commit -m "feat(schema): add Internship, InternshipRegistration, CodingContest models"
```

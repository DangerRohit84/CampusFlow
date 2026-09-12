### Task 1: Schema & Migration

**Files:**
- Modify: `packages/backend/prisma/schema.prisma`

**Interfaces:**
- Produces: `CodingProfile` and `ContestParticipation` Prisma models, User model updated with relations

- [ ] **Step 1: Add CodingProfile model to schema.prisma**

Add after the User model:

```prisma
model CodingProfile {
  id               String    @id @default(uuid())
  userId           String    @unique
  leetcodeHandle   String?
  codeforcesHandle String?
  codechefHandle   String?
  hackerrankHandle String?
  gfgHandle        String?
  lastSyncedAt     DateTime?
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Add ContestParticipation model to schema.prisma**

Add after CodingProfile:

```prisma
model ContestParticipation {
  id             String    @id @default(uuid())
  userId         String
  contestId      String?
  platform       String
  contestName    String
  contestUrl     String?
  rank           Int?
  score          Int?
  rating         Int?
  ratingChange   Int?
  problemsSolved Int?
  totalProblems  Int?
  participatedAt DateTime?
  syncedAt       DateTime  @default(now())
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, platform, contestName])
}
```

- [ ] **Step 3: Add relations to User model**

Add these two lines to the User model (after the existing `codingContests` relation):

```prisma
  codingProfile         CodingProfile?
  contestParticipations ContestParticipation[]
```

- [ ] **Step 4: Run migration**

```bash
cd packages/backend
npx prisma migrate dev --name add-coding-profiles
```

- [ ] **Step 5: Verify Prisma client generates**

```bash
npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/prisma/schema.prisma packages/backend/prisma/migrations
git commit -m "feat: add CodingProfile + ContestParticipation schema models"
```

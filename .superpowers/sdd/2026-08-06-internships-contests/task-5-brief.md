# Task 5: Backend — Seed Data

**Files:**
- Modify: `packages/backend/prisma/seed.ts`

**Interfaces:**
- Consumes: Prisma models from previous tasks

- [ ] **Step 1: Add seed data for internships**

In `seed.ts`, add after the hackathon seed section:
- Google SWE Intern (HYBRID, $8,000/month, 12 weeks)
- Microsoft PM Intern (REMOTE, $7,500/month, 16 weeks)
- One registration for Google internship

- [ ] **Step 2: Add seed data for coding contests**

- LeetCode Weekly Contest 400 (UPCOMING, next week)
- CodeChef Cook-off (UPCOMING, 3 days)
- Codeforces Round 950 Div. 2 (ENDED, last week, with one solution)

- [ ] **Step 3: Run seed**

Run: `cd packages/backend && npx tsx prisma/seed.ts`

Expected: "✓ Internships seeded" + "✓ Coding contests seeded"

- [ ] **Step 4: Commit**

```bash
git add packages/backend/prisma/seed.ts
git commit -m "feat(seed): add demo internships and coding contests"
```

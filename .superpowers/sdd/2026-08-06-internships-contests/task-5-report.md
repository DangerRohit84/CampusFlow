# Task 5: Backend — Seed Data

**Status:** DONE

**Commit:** `d61333f` — feat(seed): add demo internships and coding contests

**What was done:**
- Added internship seed data: Google SWE Intern (HYBRID, $8,000/month, 12 weeks) and Microsoft PM Intern (REMOTE, $7,500/month, 16 weeks)
- Added one internship registration for the Google internship
- Added coding contest seed data: LeetCode Weekly 400 (UPCOMING, next week), CodeChef Cook-off (UPCOMING, 3 days), Codeforces Round 950 Div. 2 (ENDED, last week, with one solution entry)
- All seed data uses deterministic IDs for idempotent upserts

**Seed output:**
```
✓ Internships seeded
✓ Coding contests seeded
```

**Test summary:** Seed runs clean with all 3 internships (2 created + 1 registration), 3 contests, and existing seed data intact.

**Concerns:** None.

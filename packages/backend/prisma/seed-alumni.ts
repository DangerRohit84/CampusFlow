// prisma/seed-alumni.ts — DEV-ONLY alumni directory seed outline.
// NEVER runs in production: hard-guards on NODE_ENV + SEED_DEMO_USERS,
// same fail-closed pattern as prisma/seed.ts (shouldSeedDemo).
// Usage (dev only): `npx tsx prisma/seed-alumni.ts`
// Requires: backend tables migrated (20260929000000_alumni_module).

import { PrismaClient } from '@prisma/client'
import { slaDatesForNewRequest } from '../src/services/alumniService'

const prisma = new PrismaClient()

const shouldSeedDemo =
  process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_USERS === 'true'

async function main(): Promise<void> {
  if (!shouldSeedDemo) {
    console.log('[seed-alumni] Skipping (production without SEED_DEMO_USERS=true).')
    return
  }
  const tablesReady =
    typeof (prisma as unknown as Record<string, unknown>).alumniProfile !== 'undefined'
    && typeof (prisma as unknown as Record<string, unknown>).mentorshipRequest !== 'undefined'
  if (!tablesReady) {
    console.log('[seed-alumni] Tables absent — run `npx prisma migrate dev` first.')
    return
  }

  // 1) Pick the demo college + two demo users (reuses seed.ts MIT fixtures).
  const college = await prisma.college.findFirst({ where: { code: 'MIT' } })
  if (!college) {
    console.log('[seed-alumni] Demo college MIT missing — run prisma/seed.ts first.')
    return
  }
  const student = await prisma.user.findFirst({ where: { email: 'alex@university.edu' } })
  const teacher = await prisma.user.findFirst({ where: { email: 'prof.sharma@university.edu' } })
  if (!student || !teacher) {
    console.log('[seed-alumni] Demo users missing — run prisma/seed.ts first.')
    return
  }

  // 2) Upsert one VERIFIED alumni profile (teacher doubles as alumni in dev).
  const db = prisma as unknown as {
    alumniProfile: { upsert: (a: never) => Promise<{ id: string }> }
    mentorshipRequest: { create: (a: never) => Promise<unknown>; deleteMany: (a: never) => Promise<unknown> }
  }
  const profile = await db.alumniProfile.upsert({
    where: { userId: teacher.id },
    create: {
      userId: teacher.id,
      collegeId: college.id,
      graduationYear: 2015,
      degree: 'B.Tech Computer Science',
      department: 'Computer Science',
      company: 'Devfolio',
      roleTitle: 'Senior Engineer',
      location: 'Bengaluru',
      bio: 'Dev-only alumni fixture. Mentors DSA + hackathons.',
      skills: ['DSA', 'React', 'System Design'],
      linkedinUrl: 'https://linkedin.com/in/dev-alumni',
      contactEmail: 'alumni.dev@example.com',
      isVerified: true,
      verifiedAt: new Date(),
      isAvailableForMentorship: true,
    },
    update: { isVerified: true, collegeId: college.id },
  } as never)
  console.log('[seed-alumni] upserted alumni profile', profile.id)

  // 3) One PENDING request (student → alumni) with live SLA dates.
  const { slaDueAt, expiresAt } = slaDatesForNewRequest(new Date())
  await db.mentorshipRequest.deleteMany({ where: { requesterId: student.id, alumniUserId: teacher.id } } as never)
  await db.mentorshipRequest.create({
    data: {
      requesterId: student.id,
      alumniUserId: teacher.id,
      alumniProfileId: profile.id,
      collegeId: college.id,
      status: 'PENDING',
      topic: 'Hackathon prep',
      message: 'Dev-only fixture: guidance on SIH prototype + judging criteria.',
      slaDueAt,
      expiresAt,
    },
  } as never)
  console.log('[seed-alumni] created 1 PENDING mentorship request (5/d quota unaffected in dev)')

  // 4) Manual verification checklist (admin):
  //   - GET /api/alumni?search=Devfolio (masked contactEmail expected)
  //   - GET /api/alumni/pending (as COLLEGE_ADMIN, new profile appears when isVerified=false)
  //   - PATCH /api/alumni/:userId/verify {verified:true} → AuditLog ALUMNI_VERIFY
  //   - POST /api/alumni/request (as student) → 201 + Notification to alumni
  //   - PATCH /api/alumni/request/:id {action:ACCEPT} (as alumni) → ChatSession + Notification
  //   - GET /api/alumni/:userId (as requester, post-accept) → full contactEmail visible
}

main()
  .catch((e) => {
    console.error('[seed-alumni] failed', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

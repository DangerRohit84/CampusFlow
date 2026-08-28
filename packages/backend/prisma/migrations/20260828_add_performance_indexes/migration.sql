-- Add performance indexes for pagination + filtered list scans (O(log n) vs O(n) seq scan)
-- Matches schema.prisma indexes added for CampusFlow fast-lists initiative
-- Based on announcements pattern: copy pagination + indexes to hackathons/internships/contests/forms/rooms

-- User: college/role filters (dashboard, admin lists)
CREATE INDEX IF NOT EXISTS "User_collegeId_role_idx" ON "User"("collegeId", "role");
CREATE INDEX IF NOT EXISTS "User_collegeId_idx" ON "User"("collegeId");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_departmentId_idx" ON "User"("departmentId");
CREATE INDEX IF NOT EXISTS "User_collegeId_departmentId_idx" ON "User"("collegeId", "departmentId");

-- Hackathon: list by college + status + createdAt (primary list query), deadline sorting
CREATE INDEX IF NOT EXISTS "Hackathon_collegeId_status_createdAt_idx" ON "Hackathon"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Hackathon_creatorId_idx" ON "Hackathon"("creatorId");
CREATE INDEX IF NOT EXISTS "Hackathon_deadline_idx" ON "Hackathon"("deadline");
CREATE INDEX IF NOT EXISTS "Hackathon_collegeId_status_idx" ON "Hackathon"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "Hackathon_status_createdAt_idx" ON "Hackathon"("status", "createdAt");

-- HackathonStaging: same + staging status filter
CREATE INDEX IF NOT EXISTS "HackathonStaging_collegeId_status_createdAt_idx" ON "HackathonStaging"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "HackathonStaging_creatorId_idx" ON "HackathonStaging"("creatorId");
CREATE INDEX IF NOT EXISTS "HackathonStaging_deadline_idx" ON "HackathonStaging"("deadline");
CREATE INDEX IF NOT EXISTS "HackathonStaging_status_idx" ON "HackathonStaging"("status");

-- InternshipStaging
CREATE INDEX IF NOT EXISTS "InternshipStaging_collegeId_status_createdAt_idx" ON "InternshipStaging"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "InternshipStaging_creatorId_idx" ON "InternshipStaging"("creatorId");
CREATE INDEX IF NOT EXISTS "InternshipStaging_status_idx" ON "InternshipStaging"("status");
CREATE INDEX IF NOT EXISTS "InternshipStaging_deadline_idx" ON "InternshipStaging"("deadline");

-- Internship
CREATE INDEX IF NOT EXISTS "Internship_collegeId_status_createdAt_idx" ON "Internship"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Internship_creatorId_idx" ON "Internship"("creatorId");
CREATE INDEX IF NOT EXISTS "Internship_collegeId_status_idx" ON "Internship"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "Internship_status_createdAt_idx" ON "Internship"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Internship_deadline_idx" ON "Internship"("deadline");

-- CodingContest: platform/status/college filters + startTime sort
CREATE INDEX IF NOT EXISTS "CodingContest_collegeId_status_createdAt_idx" ON "CodingContest"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CodingContest_creatorId_idx" ON "CodingContest"("creatorId");
CREATE INDEX IF NOT EXISTS "CodingContest_platform_idx" ON "CodingContest"("platform");
CREATE INDEX IF NOT EXISTS "CodingContest_status_idx" ON "CodingContest"("status");
CREATE INDEX IF NOT EXISTS "CodingContest_collegeId_idx" ON "CodingContest"("collegeId");
CREATE INDEX IF NOT EXISTS "CodingContest_collegeId_status_idx" ON "CodingContest"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "CodingContest_platform_status_idx" ON "CodingContest"("platform", "status");
CREATE INDEX IF NOT EXISTS "CodingContest_startTime_idx" ON "CodingContest"("startTime");
CREATE INDEX IF NOT EXISTS "CodingContest_status_startTime_idx" ON "CodingContest"("status", "startTime");

-- Form: college/status listing
CREATE INDEX IF NOT EXISTS "Form_collegeId_status_createdAt_idx" ON "Form"("collegeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Form_creatorId_idx" ON "Form"("creatorId");
CREATE INDEX IF NOT EXISTS "Form_collegeId_status_idx" ON "Form"("collegeId", "status");
CREATE INDEX IF NOT EXISTS "Form_status_createdAt_idx" ON "Form"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Form_collegeId_idx" ON "Form"("collegeId");

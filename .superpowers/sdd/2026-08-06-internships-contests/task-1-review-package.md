# Review Package — Task 1: Prisma Schema + Migration

## Commits

80dc100 feat(schema): add Internship, InternshipRegistration, CodingContest models

## Files Changed

 packages/backend/prisma/schema.prisma | 60 +++++++++++++++++++++++++++++++++++
 1 file changed, 60 insertions(+)

## Diff

```diff
diff --git a/packages/backend/prisma/schema.prisma b/packages/backend/prisma/schema.prisma
index 4fa5f67..63c3870 100644
--- a/packages/backend/prisma/schema.prisma
+++ b/packages/backend/prisma/schema.prisma
@@ -38,20 +38,23 @@ model User {
   hackathonsCreated Hackathon[] @relation("HackathonCreator")
   registrations     HackathonRegistration[]
   formsCreated      Form[]
   formResponses     FormResponse[]
   teachingCourses   Course[]
   enrollments       Enrollment[]
   createdRooms      Room[]
   joinedRooms       RoomMember[]
   uploadedResources Resource[]
   roomNotifications RoomNotification[]
+  internships         Internship[]
+  internshipRegistrations InternshipRegistration[]
+  codingContests      CodingContests[]
 }
 
 model Schedule {
   id          String   @id @default(cuid())
   userId      String
   title       String
   course      String?
   location    String?
   teacher     String?
   dayOfWeek   Int
@@ -227,20 +230,22 @@ model College {
   adminEmail  String?
   status      String   @default("PENDING")
   createdAt   DateTime @default(now())
   updatedAt   DateTime @updatedAt
 
   users       User[]
   hackathons  Hackathon[]
   forms       Form[]
   courses     Course[]
   departments Department[]
+  internships         Internship[]
+  codingContests      CodingContest[]
 }
 
 model Department {
   id        String   @id @default(uuid())
   name      String
   collegeId String
   createdAt DateTime @default(now())
 
   college College @relation(fields: [collegeId], references: [id], onDelete: Cascade)
   users   User[]
@@ -285,20 +290,22 @@ model Hackathon {
 
 model HackathonRegistration {
   id           String   @id @default(uuid())
   hackathonId  String
   userId       String
   teamName     String?
   teamMembers  String?
   projectIdea  String?
   status       String   @default("REGISTERED")
   currentRound Int      @default(0)
+  winPosition  String?
+  review       String?
   createdAt    DateTime @default(now())
   updatedAt    DateTime @updatedAt
 
   hackathon Hackathon @relation(fields: [hackathonId], references: [id], onDelete: Cascade)
   user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
 
   @@unique([hackathonId, userId])
 }
 
 model HackathonRound {
@@ -310,20 +317,73 @@ model HackathonRound {
   date         DateTime?
   resultDate   DateTime?
   createdAt    DateTime @default(now())
   updatedAt    DateTime @updatedAt
 
   hackathon Hackathon @relation(fields: [hackathonId], references: [id], onDelete: Cascade)
 
   @@unique([hackathonId, roundNumber])
 }
 
+model Internship {
+  id                 String   @id @default(uuid())
+  creatorId          String
+  collegeId          String
+  title              String
+  description        String
+  company            String
+  role               String
+  url                String
+  stipend            String?
+  duration           String?
+  mode               String   @default("REMOTE")
+  startDate          String?
+  deadline           String?
+  targetDepartments  String   @default("[]")
+  targetYears        String   @default("[]")
+  eligibilityEnabled Boolean  @default(false)
+  status             String   @default("ACTIVE")
+  createdAt          DateTime @default(now())
+  creator            User     @relation(fields: [creatorId], references: [id])
+  college            College  @relation(fields: [collegeId], references: [id])
+  registrations      InternshipRegistration[]
+}
+
+model InternshipRegistration {
+  id           String     @id @default(uuid())
+  internshipId String
+  userId       String
+  status       String     @default("REGISTERED")
+  reportedAt   DateTime?
+  internship   Internship @relation(fields: [internshipId], references: [id])
+  user         User       @relation(fields: [userId], references: [id])
+  @@unique([internshipId, userId])
+}
+
+model CodingContest {
+  id            String   @id @default(uuid())
+  title         String
+  platform      String
+  url           String
+  startTime     String
+  duration      Int?
+  contestType   String?
+  status        String   @default("UPCOMING")
+  solutions     String   @default("[]")
+  isAutoFetched Boolean  @default(false)
+  creatorId     String?
+  collegeId     String?
+  createdAt     DateTime @default(now())
+  creator       User?    @relation(fields: [creatorId], references: [id])
+  college       College? @relation(fields: [collegeId], references: [id])
+}
+
 model Form {
   id                  String    @id @default(uuid())
   creatorId           String
   collegeId           String?
   title               String
   description         String?
   status              String    @default("ACTIVE")
   allowEdit           Boolean   @default(false)
   expiresAt           DateTime?
   targetDepartments   String    @default("[]")
```

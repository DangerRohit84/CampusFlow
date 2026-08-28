-- CreateEnum
CREATE TYPE "AssignmentScope" AS ENUM ('ALL', 'DEPARTMENT', 'ROOM');

-- CreateEnum
CREATE TYPE "SubmissionMode" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');

-- CreateTable
CREATE TABLE "AssignmentHub" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "courseId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "creatorId" TEXT NOT NULL,
    "collegeId" TEXT,
    "scope" "AssignmentScope" NOT NULL DEFAULT 'ALL',
    "departmentId" TEXT,
    "roomId" TEXT,
    "submissionMode" "SubmissionMode" NOT NULL DEFAULT 'ONLINE',
    "showGrades" BOOLEAN NOT NULL DEFAULT true,
    "showFeedback" BOOLEAN NOT NULL DEFAULT true,
    "showSubmissionStatus" BOOLEAN NOT NULL DEFAULT true,
    "showStats" BOOLEAN NOT NULL DEFAULT false,
    "maxPoints" INTEGER NOT NULL DEFAULT 100,
    "maxGrade" TEXT,
    "allowLateSubmission" BOOLEAN NOT NULL DEFAULT false,
    "attachments" TEXT DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentHub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSubmission" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "content" TEXT,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "grade" TEXT,
    "points" INTEGER,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),
    "gradedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSubmission_assignmentId_studentId_key" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "AssignmentHub_collegeId_scope_idx" ON "AssignmentHub"("collegeId", "scope");

-- CreateIndex
CREATE INDEX "AssignmentHub_departmentId_idx" ON "AssignmentHub"("departmentId");

-- CreateIndex
CREATE INDEX "AssignmentHub_roomId_idx" ON "AssignmentHub"("roomId");

-- CreateIndex
CREATE INDEX "AssignmentHub_creatorId_idx" ON "AssignmentHub"("creatorId");

-- CreateIndex
CREATE INDEX "AssignmentHub_dueDate_idx" ON "AssignmentHub"("dueDate");

-- CreateIndex
CREATE INDEX "AssignmentHub_collegeId_dueDate_idx" ON "AssignmentHub"("collegeId", "dueDate");

-- CreateIndex
CREATE INDEX "AssignmentHub_scope_dueDate_idx" ON "AssignmentHub"("scope", "dueDate");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_assignmentId_idx" ON "AssignmentSubmission"("assignmentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_studentId_idx" ON "AssignmentSubmission"("studentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_assignmentId_studentId_idx" ON "AssignmentSubmission"("assignmentId", "studentId");

-- CreateIndex
CREATE INDEX "AssignmentSubmission_status_idx" ON "AssignmentSubmission"("status");

-- AddForeignKey
ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentHub" ADD CONSTRAINT "AssignmentHub_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "AssignmentHub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSubmission" ADD CONSTRAINT "AssignmentSubmission_gradedBy_fkey" FOREIGN KEY ("gradedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

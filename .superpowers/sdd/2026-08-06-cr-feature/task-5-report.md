Status: DONE
Commits: 9afc211
Test summary: TypeScript compiles cleanly (npx tsc --noEmit shows no errors for RoomDetailPage.tsx). Verified API methods makeCR/removeCR exist in api.ts.
Concerns: Used member.studentId instead of member.student.id for the student ID parameter since existing codebase uses flat member.studentId. Backend must return isCR on the member object for the badge and toggle to work correctly.

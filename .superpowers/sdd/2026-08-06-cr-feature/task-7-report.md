Status: DONE
Commits: 95b2f0a
Test summary: TypeScript compiles cleanly with no errors in FormsPage.tsx. Changes: added `crRoomIds` state, useEffect to fetch rooms where user is CR (populating both `crRoomIds` and `teacherRooms` for eligibility popup), `canCreate` variable combining teacher/admin/CR checks, and replaced `isTeacher` with `canCreate` on the create button.
Concerns: none

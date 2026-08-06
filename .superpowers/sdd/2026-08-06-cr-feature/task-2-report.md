Status: DONE
Commits: e83a70d
Test summary: TypeScript compilation passes with no errors for rooms.ts. Routes added follow existing patterns and use router-level authentication middleware.
Concerns: The brief mentioned adding `authMiddleware` import but the existing codebase uses `authenticate` applied globally via `router.use(authenticate)`. I omitted per-route middleware to stay consistent with existing routes. This is acceptable because all routes are already protected.
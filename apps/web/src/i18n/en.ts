// i18n/en.ts — #12 English strings (source of truth).
// WHY: single source for nav + auth + common first (bounded #12 scope).
// Remaining ~55 pages stay hardcoded English until translated — see
// docs/i18n-coverage.md (no machine-translation bulk per task).
// ADDING A LANGUAGE: copy this file to <locale>.ts, translate values only
// (keep keys identical), register in index.ts LOCALES + load in
// LanguageContext. Keys are dot-paths (e.g. t('nav.overview')).

export const en = {
  nav: {
    overview: 'Overview',
    timetable: 'Timetable',
    attendance: 'Attendance',
    grades: 'Grades',
    assignments: 'Assignments',
    planner: 'Planner',
    hackathons: 'Hackathons',
    internships: 'Internships',
    contests: 'Contests',
    codingProfile: 'Coding Profile',
    calendar: 'Calendar',
    forms: 'Forms',
    rooms: 'Rooms',
    resumeStudio: 'Resume Studio',
    portfolioStudio: 'Portfolio Studio',
    opportunities: 'Opportunities',
    leaderboard: 'Leaderboard',
    adminPanel: 'Admin Panel',
    reports: 'Reports',
    settings: 'Settings',
    notifications: 'Notifications',
    search: 'Search',
    chat: 'Chat',
  },
  auth: {
    login: 'Sign In',
    register: 'Sign Up',
    logout: 'Sign Out',
    email: 'Email',
    password: 'Password',
    currentPassword: 'Current Password',
    newPassword: 'New Password',
    confirmPassword: 'Confirm New Password',
    forgotPassword: 'Forgot password?',
    welcomeBack: 'Welcome back',
    createAccount: 'Create account',
    noAccount: "Don't have an account?",
    haveAccount: 'Already have an account?',
  },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    close: 'Close',
    loading: 'Loading...',
    retry: 'Retry',
    search: 'Search',
    actions: 'Actions',
    language: 'Language',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Manage your account preferences, security and integrations.',
    profile: 'Profile',
    security: 'Security',
    appearance: 'Appearance',
    notifications: 'Notification Preferences',
    dangerZone: 'Danger Zone',
    dangerZoneSub: 'Permanently delete your account and erase personal data.',
    deleteAccount: 'Delete Account',
    deleteConfirmTitle: 'Delete your account?',
    deleteConfirmBody:
      'This erases your name, email, student/employee ID, avatar, portfolio and preferences. Your registrations and submissions stay but are detached from your identity. This cannot be undone.',
    deleteStepPassword: 'Step 1 — confirm your password',
    deleteStepType: 'Step 2 — type DELETE to confirm',
    deleteTypePlaceholder: 'Type DELETE',
    deleteCta: 'Permanently delete my account',
    deleteSuccess: 'Account deleted. You have been signed out.',
    languageSub: 'Choose your display language.',
  },
} as const

export type EnShape = typeof en

/** Dot-path keys of en (nav.overview, auth.login, …). Loose string fallback for forward-compat. */
export type LanguageKey =
  | `nav.${keyof EnShape['nav'] & string}`
  | `auth.${keyof EnShape['auth'] & string}`
  | `common.${keyof EnShape['common'] & string}`
  | `settings.${keyof EnShape['settings'] & string}`
  | (string & {})

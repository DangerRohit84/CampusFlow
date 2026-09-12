import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { RouteSeo } from './components/Seo'
import { ConfirmProvider } from './components/ui/ConfirmModal'
import CenteredLoader from './components/ui/CenteredLoader'
import CookieConsent from './components/CookieConsent'
import { trackPageView } from './lib/analytics'
import { getLandingRouteForRole } from './lib/authRedirect'
import { LOGOUT_DEST, isEffectivelyAuthenticated } from './lib/logout'
// Eager: light + first-paint routes only (public shell + auth). Everything else
// stays lazy so initial bundle stays lean like Vercel/Shopify.
// WHY: 2026-09-09 build-all I-1 — 43 eager page imports put framer-motion +
// query + layout chains into index (~1.16MB). Lazy routes load on demand via
// LazyRoute (Suspense role=status + ErrorBoundary). First paint needs only
// Login/Register/Landing/legal/404 shell; Dashboard + app routes lazy-load
// after auth (one extra round-trip, cached per-route thereafter).
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import LandingPage from './pages/LandingPage'
import NotFoundPage from './pages/NotFoundPage'
import ForbiddenPage from './pages/ForbiddenPage'
import ErrorPage from './pages/ErrorPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import HelpPage from './pages/HelpPage'
import AboutPage from './pages/AboutPage'
import ContactPage from './pages/ContactPage'
// Heavy + app routes — route-level code splitting (Stripe/GitHub pattern). Each
// chunk loads on demand; Suspense fallback keeps a11y role=status loader.
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const AssignmentsPage = lazy(() => import('./pages/AssignmentsPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const InsightsPage = lazy(() => import('./pages/InsightsPage'))
const GradesPage = lazy(() => import('./pages/GradesPage'))
const AttendancePage = lazy(() => import('./pages/AttendancePage'))
const HackathonsPage = lazy(() => import('./pages/HackathonsPage'))
const HackathonDetailPage = lazy(() => import('./pages/HackathonDetailPage'))
const InternshipsPage = lazy(() => import('./pages/InternshipsPage'))
const TeacherAssignedPage = lazy(() => import('./pages/TeacherAssignedPage'))
const CodingContestsPage = lazy(() => import('./pages/CodingContestsPage'))
const ContestLeaderboardPage = lazy(() => import('./pages/ContestLeaderboardPage'))
const CodingProfilePage = lazy(() => import('./pages/CodingProfilePage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const InternshipDetailPage = lazy(() => import('./pages/InternshipDetailPage'))
const FormsPage = lazy(() => import('./pages/FormsPage'))
const FormDetailPage = lazy(() => import('./pages/FormDetailPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const CollegeRegistrationPage = lazy(() => import('./pages/CollegeRegistrationPage'))
const AddTeacherPage = lazy(() => import('./pages/AddTeacherPage'))
const AddStudentPage = lazy(() => import('./pages/AddStudentPage'))
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage'))
const RoomsPage = lazy(() => import('./pages/RoomsPage'))
const RoomDetailPage = lazy(() => import('./pages/RoomDetailPage'))
const StudentRoomsPage = lazy(() => import('./pages/StudentRoomsPage'))
const StudentRoomDetailPage = lazy(() => import('./pages/StudentRoomDetailPage'))
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'))
const AssignmentDetailPage = lazy(() => import('./pages/AssignmentDetailPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
// Heavy routes — route-level code splitting (Stripe/GitHub pattern). Each
// chunk loads on demand; Suspense fallback keeps a11y role=status loader.
const ResumeStudioPage = lazy(() => import('./pages/ResumeStudioPage'))
const PortfolioStudioPage = lazy(() => import('./pages/PortfolioStudioPage'))
const AdminOpportunitiesPage = lazy(() => import('./pages/AdminOpportunitiesPage'))
const FetchPage = lazy(() => import('./pages/FetchPage'))
const AiManagerPage = lazy(() => import('./pages/AiManagerPage'))
const SuperAdminDashboardPage = lazy(() => import('./pages/SuperAdminDashboardPage'))
const SuperAdminCollegesPage = lazy(() => import('./pages/SuperAdminCollegesPage'))
const SuperAdminCollegeView = lazy(() => import('./pages/SuperAdminCollegeView'))
const SuperAdminReportsPage = lazy(() => import('./pages/SuperAdminReportsPage'))

function LazyRoute({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<CenteredLoader text={label || 'Loading...'} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  // WHY logout flash: checking isAuthenticated alone let a stale true (logout
  // still awaiting network) render protected UI one tick. Require user too.
  if (!isEffectivelyAuthenticated(isAuthenticated, user)) return <Navigate to={LOGOUT_DEST} replace />
  return <>{children}</>
}

function LandingRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.user?.role)
  // Role-aware landing: SUPER_ADMIN → /superadmin, COLLEGE_ADMIN/STUDENT/TEACHER → /dashboard.
  // WHY: hardcoded /dashboard sent superadmins to the tenant dashboard after login.
  // WHY logout flash: logged-out (user null) must never bounce to dashboard,
  // even if a stale isAuthenticated=true lingers one tick during logout.
  if (isEffectivelyAuthenticated(isAuthenticated, user)) return <Navigate to={getLandingRouteForRole(role)} replace />
  return <>{children}</>
}

function RoomsRoute() {
  const user = useAuthStore((s) => s.user)
  if (user?.role === 'STUDENT') return <StudentRoomsPage />
  return <RoomsPage />
}

function RoomDetailRoute() {
  const user = useAuthStore((s) => s.user)
  if (user?.role === 'STUDENT') return <StudentRoomDetailPage />
  return <RoomDetailPage />
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.user?.role)
  // Role-aware guard: an already-authed COLLEGE_ADMIN visiting /login bounces to
  // /dashboard (explicit, not fallthrough); SUPER_ADMIN bounces to /superadmin.
  // WHY: hardcoded /dashboard is correct for COLLEGE_ADMIN but wrong for SUPER_ADMIN,
  // and pairs with LoginPage's resolvePostLoginDest (stale superadmin saved route
  // must not send a college-admin to /superadmin/* → /403).
  // WHY logout flash: logout() clears user sync before navigate(LOGOUT_DEST).
  // Checking isAuthenticated alone bounced a logging-out user (stale true) to
  // /dashboard; requiring user closes it — logged-out always stays on /login.
  if (isEffectivelyAuthenticated(isAuthenticated, user)) return <Navigate to={getLandingRouteForRole(role)} replace />
  return <>{children}</>
}

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  // WHY: wrong-role access is a 403 with request ID + support link, not a
  // silent redirect — users learn why they were blocked and how to appeal.
  if (user?.role !== 'SUPER_ADMIN') return <Navigate to="/403" replace />
  return <>{children}</>
}

function AuthRedirectListener() {
  const navigate = useNavigate()
  useEffect(() => {
    const handler = () => {
      try {
        // Fast sync logout (fire-and-forget server, sync local clear) — no hard reload.
        // WHY: store clears user/token sync before this navigate() runs, so
        // GuestRoute sees logged-out and stays on /login (no dashboard flash).
        useAuthStore.getState().logout()
      } catch {}
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        navigate(LOGOUT_DEST, { replace: true })
      }
    }
    window.addEventListener('auth:expired', handler as EventListener)
    return () => window.removeEventListener('auth:expired', handler as EventListener)
  }, [navigate])
  return null
}

/**
 * WHY: SPA route changes must move focus (WCAG 2.4.3) — otherwise SR users stay
 * on the old heading. Focus main (or its h1) on every pathname change + track pageview.
 */
function RouteFocus() {
  const pathname = useLocation().pathname
  useEffect(() => {
    trackPageView(pathname)
    // Let the new route paint before moving focus (avoids focusing a stale node).
    const t = window.setTimeout(() => {
      try {
        const main =
          document.getElementById('main-content') ??
          document.getElementById('public-main') ??
          document.querySelector('main')
        if (!main) return
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
        const h1 = main.querySelector('h1')
        if (h1) {
          if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
          ;(h1 as HTMLElement).focus({ preventScroll: true })
          // Prefer main scroll position at top on route change.
          try {
            ;(main as HTMLElement).scrollTop = 0
          } catch {}
        } else {
          ;(main as HTMLElement).focus({ preventScroll: true })
        }
      } catch {}
    }, 60)
    return () => window.clearTimeout(t)
  }, [pathname])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthRedirectListener />
      <RouteFocus />
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'font-medium rounded-xl',
          style: { background: '#121212', color: '#ffffff' },
          duration: 4000,
          ariaProps: { role: 'status', 'aria-live': 'polite' },
        }}
      />
      <ErrorBoundary>
        <ConfirmProvider>
          <RouteSeo />
          <CookieConsent />
          <Routes>
          <Route path="/" element={<LandingRoute><LandingPage /></LandingRoute>} />
          {/* WHY: /landing is a legacy alias — 301-equivalent SPA redirect to / (canonical). Server (nginx) also 301s /landing→/. Keeps old links working without duplicate index. */}
          <Route path="/landing" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
          <Route path="/register-college" element={<LazyRoute label="Loading registration..."><CollegeRegistrationPage /></LazyRoute>} />
          {/* Public legal/support/error pages — no auth, own minimal chrome */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/error" element={<ErrorPage />} />
          {/* public profile - accessible without layout but also needs auth for private data; keep outside ProtectedRoute but still render */}
          <Route path="/u/:username" element={<LazyRoute label="Loading profile..."><PublicProfilePage /></LazyRoute>} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            {/* WHY: all app routes lazy (I-1) — Suspense role=status loader keeps a11y + RouteFocus (main/h1) intact. */}
            <Route path="dashboard" element={<LazyRoute label="Loading overview..."><DashboardPage /></LazyRoute>} />
            <Route path="schedule" element={<LazyRoute label="Loading timetable..."><SchedulePage /></LazyRoute>} />
            <Route path="chat" element={<LazyRoute label="Loading chat..."><ChatPage /></LazyRoute>} />
            <Route path="assignments" element={<LazyRoute label="Loading assignments..."><AssignmentsPage /></LazyRoute>} />
            <Route path="assignments/:hubId" element={<LazyRoute label="Loading assignment..."><AssignmentDetailPage /></LazyRoute>} />
            <Route path="grades" element={<LazyRoute label="Loading grades..."><GradesPage /></LazyRoute>} />
            <Route path="attendance" element={<LazyRoute label="Loading attendance..."><AttendancePage /></LazyRoute>} />
            <Route path="tasks" element={<LazyRoute label="Loading planner..."><TasksPage /></LazyRoute>} />
            <Route path="calendar" element={<LazyRoute label="Loading calendar..."><CalendarPage /></LazyRoute>} />
            <Route path="notifications" element={<LazyRoute label="Loading notifications..."><NotificationsPage /></LazyRoute>} />
            <Route path="search" element={<LazyRoute label="Loading search..."><SearchPage /></LazyRoute>} />
            <Route path="insights" element={<LazyRoute label="Loading insights..."><InsightsPage /></LazyRoute>} />
            <Route path="settings" element={<LazyRoute label="Loading settings..."><SettingsPage /></LazyRoute>} />
            <Route path="hackathons" element={<LazyRoute label="Loading hackathons..."><HackathonsPage /></LazyRoute>} />
            <Route path="hackathons/:id" element={<LazyRoute label="Loading hackathon..."><HackathonDetailPage /></LazyRoute>} />
            <Route path="internships" element={<LazyRoute label="Loading internships..."><InternshipsPage /></LazyRoute>} />
            <Route path="internships/:id" element={<LazyRoute label="Loading internship..."><InternshipDetailPage /></LazyRoute>} />
            <Route path="teacher/opportunities" element={<LazyRoute label="Loading opportunities..."><TeacherAssignedPage /></LazyRoute>} />
            <Route path="contests" element={<LazyRoute label="Loading contests..."><CodingContestsPage /></LazyRoute>} />
            <Route path="contests/leaderboard" element={<LazyRoute label="Loading leaderboard..."><ContestLeaderboardPage /></LazyRoute>} />
            <Route path="coding-profile" element={<LazyRoute label="Loading coding profile..."><CodingProfilePage /></LazyRoute>} />
            <Route path="resume-studio" element={<LazyRoute label="Loading Resume Studio..."><ResumeStudioPage /></LazyRoute>} />
            <Route path="portfolio-studio" element={<LazyRoute label="Loading Portfolio Studio..."><PortfolioStudioPage /></LazyRoute>} />

            <Route path="forms" element={<LazyRoute label="Loading forms..."><FormsPage /></LazyRoute>} />
            <Route path="forms/:id" element={<LazyRoute label="Loading form..."><FormDetailPage /></LazyRoute>} />
            <Route path="rooms" element={<LazyRoute label="Loading rooms..."><RoomsRoute /></LazyRoute>} />
            <Route path="rooms/:id" element={<LazyRoute label="Loading room..."><RoomDetailRoute /></LazyRoute>} />
            <Route path="reports" element={<LazyRoute label="Loading reports..."><ReportsPage /></LazyRoute>} />
            <Route path="admin" element={<LazyRoute label="Loading admin..."><AdminPage /></LazyRoute>} />
            <Route path="admin/opportunities" element={<LazyRoute label="Loading opportunities..."><AdminOpportunitiesPage /></LazyRoute>} />
            <Route path="superadmin" element={<SuperAdminGuard><LazyRoute label="Loading dashboard..."><SuperAdminDashboardPage /></LazyRoute></SuperAdminGuard>} />
            <Route path="superadmin/colleges" element={<SuperAdminGuard><LazyRoute label="Loading colleges..."><SuperAdminCollegesPage /></LazyRoute></SuperAdminGuard>} />
            <Route path="superadmin/colleges/:collegeId" element={<SuperAdminGuard><LazyRoute label="Loading college..."><SuperAdminCollegeView /></LazyRoute></SuperAdminGuard>} />
            <Route path="superadmin/reports" element={<SuperAdminGuard><LazyRoute label="Loading reports..."><SuperAdminReportsPage /></LazyRoute></SuperAdminGuard>} />
            <Route path="admin/dashboard" element={<Navigate to="/superadmin" replace />} />
            <Route path="admin/register-college" element={<LazyRoute label="Loading registration..."><CollegeRegistrationPage /></LazyRoute>} />
            <Route path="admin/add-teachers" element={<LazyRoute label="Loading..."><AddTeacherPage /></LazyRoute>} />
            <Route path="admin/add-students" element={<LazyRoute label="Loading..."><AddStudentPage /></LazyRoute>} />
            <Route path="admin/fetch" element={<SuperAdminGuard><LazyRoute label="Loading fetch console..."><FetchPage /></LazyRoute></SuperAdminGuard>} />
            <Route path="admin/ai-manager" element={<SuperAdminGuard><LazyRoute label="Loading AI manager..."><AiManagerPage /></LazyRoute></SuperAdminGuard>} />
            <Route path="announcements" element={<LazyRoute label="Loading announcements..."><AnnouncementsPage /></LazyRoute>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </ConfirmProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}

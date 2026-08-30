import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import SchedulePage from './pages/SchedulePage'
import ChatPage from './pages/ChatPage'
import AssignmentsPage from './pages/AssignmentsPage'
import NotificationsPage from './pages/NotificationsPage'
import SettingsPage from './pages/SettingsPage'
import SearchPage from './pages/SearchPage'
import InsightsPage from './pages/InsightsPage'
import GradesPage from './pages/GradesPage'
import AttendancePage from './pages/AttendancePage'
import HackathonsPage from './pages/HackathonsPage'
import HackathonDetailPage from './pages/HackathonDetailPage'
import InternshipsPage from './pages/InternshipsPage'
import AdminOpportunitiesPage from './pages/AdminOpportunitiesPage'
import TeacherAssignedPage from './pages/TeacherAssignedPage'
import CodingContestsPage from './pages/CodingContestsPage'
import ContestLeaderboardPage from './pages/ContestLeaderboardPage'
import CodingProfilePage from './pages/CodingProfilePage'
import TasksPage from './pages/TasksPage'
import InternshipDetailPage from './pages/InternshipDetailPage'
import FormsPage from './pages/FormsPage'
import FormDetailPage from './pages/FormDetailPage'
import CalendarPage from './pages/CalendarPage'
import AdminPage from './pages/AdminPage'
import CollegeRegistrationPage from './pages/CollegeRegistrationPage'
import AddTeacherPage from './pages/AddTeacherPage'
import AddStudentPage from './pages/AddStudentPage'
import FetchPage from './pages/FetchPage'
import AiManagerPage from './pages/AiManagerPage'
import AnnouncementsPage from './pages/AnnouncementsPage'
import RoomsPage from './pages/RoomsPage'
import RoomDetailPage from './pages/RoomDetailPage'
import StudentRoomsPage from './pages/StudentRoomsPage'
import StudentRoomDetailPage from './pages/StudentRoomDetailPage'
import ResumeStudioPage from './pages/ResumeStudioPage'
import PortfolioStudioPage from './pages/PortfolioStudioPage'
import PublicProfilePage from './pages/PublicProfilePage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
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
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'font-medium rounded-xl',
          style: { background: '#1f2937', color: '#f9fafb' },
        }}
      />
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
          <Route path="/register-college" element={<CollegeRegistrationPage />} />
          {/* public profile - accessible without layout but also needs auth for private data; keep outside ProtectedRoute but still render */}
          <Route path="/u/:username" element={<PublicProfilePage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="assignments" element={<AssignmentsPage />} />
            <Route path="grades" element={<GradesPage />} />
            <Route path="attendance" element={<AttendancePage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="insights" element={<InsightsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="hackathons" element={<HackathonsPage />} />
            <Route path="hackathons/:id" element={<HackathonDetailPage />} />
            <Route path="internships" element={<InternshipsPage />} />
            <Route path="internships/:id" element={<InternshipDetailPage />} />
            <Route path="admin/opportunities" element={<AdminOpportunitiesPage />} />
            <Route path="teacher/opportunities" element={<TeacherAssignedPage />} />
            <Route path="contests" element={<CodingContestsPage />} />
            <Route path="contests/leaderboard" element={<ContestLeaderboardPage />} />
            <Route path="coding-profile" element={<CodingProfilePage />} />
            <Route path="resume-studio" element={<ResumeStudioPage />} />
            <Route path="portfolio-studio" element={<PortfolioStudioPage />} />

            <Route path="forms" element={<FormsPage />} />
            <Route path="forms/:id" element={<FormDetailPage />} />
            <Route path="rooms" element={<RoomsRoute />} />
            <Route path="rooms/:id" element={<RoomDetailRoute />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="admin/register-college" element={<CollegeRegistrationPage />} />
            <Route path="admin/add-teachers" element={<AddTeacherPage />} />
            <Route path="admin/add-students" element={<AddStudentPage />} />
            <Route path="admin/fetch" element={<FetchPage />} />
            <Route path="admin/ai-manager" element={<AiManagerPage />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
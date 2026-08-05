import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import Layout from './components/layout/Layout'
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
import FormsPage from './pages/FormsPage'
import FormDetailPage from './pages/FormDetailPage'
import AdminPage from './pages/AdminPage'
import CollegeRegistrationPage from './pages/CollegeRegistrationPage'
import AddTeacherPage from './pages/AddTeacherPage'
import AddStudentPage from './pages/AddStudentPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
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
      <Routes>
        <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
        <Route path="/register-college" element={<CollegeRegistrationPage />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="grades" element={<GradesPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="hackathons" element={<HackathonsPage />} />
          <Route path="hackathons/:id" element={<HackathonDetailPage />} />
          <Route path="forms" element={<FormsPage />} />
          <Route path="forms/:id" element={<FormDetailPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/register-college" element={<CollegeRegistrationPage />} />
          <Route path="admin/add-teachers" element={<AddTeacherPage />} />
          <Route path="admin/add-students" element={<AddStudentPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
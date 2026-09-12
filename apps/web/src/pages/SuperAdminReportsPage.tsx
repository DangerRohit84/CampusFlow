import ReportsPage from './ReportsPage'
// Super Admin reports page reuses ReportsPage but ensures super admin context
// Keeps separate route /superadmin/reports as requested
export default function SuperAdminReportsPage() {
  return <ReportsPage />
}

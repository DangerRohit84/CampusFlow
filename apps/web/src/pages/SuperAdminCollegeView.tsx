import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { adminAPI } from '../lib/api'
import { useSuperAdminCollegeStore, syncLegacyStorage } from '../store/superAdminCollegeStore'
import CenteredLoader from '../components/ui/CenteredLoader'

/**
 * Backward-compat redirect: /superadmin/colleges/:collegeId used to render a duplicate Admin panel.
 * Now we reuse the single Admin Panel at /admin?collegeId=xxx — so this route just sets the
 * scoped college and redirects there. Keeps old links/bookmarks working.
 */
export default function SuperAdminCollegeView() {
  const { collegeId } = useParams<{ collegeId: string }>()
  const navigate = useNavigate()
  const { setSelectedCollege } = useSuperAdminCollegeStore()

  useEffect(() => {
    if (!collegeId) {
      navigate('/superadmin/colleges', { replace: true })
      return
    }
    let cancelled = false
    const go = async () => {
      try {
        const colleges = await adminAPI.getColleges()
        const found = (colleges as any[]).find((c) => c.id === collegeId)
        if (!cancelled) {
          if (found) {
            setSelectedCollege(found.id, found.name, found.code)
            syncLegacyStorage(found.id, found.name)
            try {
              localStorage.setItem('superadmin_selectedCollegeId', found.id)
              localStorage.setItem('superadmin_selectedCollegeName', found.name)
            } catch {}
            navigate(`/admin?collegeId=${found.id}&collegeName=${encodeURIComponent(found.name)}`, { replace: true })
          } else {
            setSelectedCollege(collegeId, collegeId, null)
            syncLegacyStorage(collegeId, collegeId)
            try { localStorage.setItem('superadmin_selectedCollegeId', collegeId) } catch {}
            navigate(`/admin?collegeId=${collegeId}`, { replace: true })
          }
        }
      } catch {
        if (!cancelled) {
          setSelectedCollege(collegeId, collegeId, null)
          syncLegacyStorage(collegeId, collegeId)
          try { localStorage.setItem('superadmin_selectedCollegeId', collegeId) } catch {}
          navigate(`/admin?collegeId=${collegeId}`, { replace: true })
        }
      }
    }
    go()
    return () => { cancelled = true }
  }, [collegeId, navigate, setSelectedCollege])

  return (
    <div className="max-w-[1280px] mx-auto">
      <CenteredLoader text="Loading college..." />
    </div>
  )
}

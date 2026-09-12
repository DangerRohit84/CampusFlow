import { useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { adminAPI } from '../lib/api'
import { queryClient } from '../lib/queryClient'
import { qk } from '../lib/queryKeys'
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
  const [searchParams] = useSearchParams()
  const { setSelectedCollege } = useSuperAdminCollegeStore()

  useEffect(() => {
    if (!collegeId) {
      navigate('/superadmin/colleges', { replace: true })
      return
    }
    // WHY one-click fix: preserve ?tab= (default analytics) so legacy
    // /superadmin/colleges/:id links land directly on the requested detail tab.
    const rawTab = searchParams.get('tab')
    const tab = rawTab === 'users' || rawTab === 'departments' || rawTab === 'content' ? rawTab : 'analytics'
    let cancelled = false
    const go = async () => {
      try {
        // CACHE-FIRST (PERPAGE-HALF2): this route only needs id→name to seed
        // the /admin detail scope — reuse the shared ['admin-colleges'] RQ
        // entry (staleTime 30s, owned by SuperAdminCollegesPage/AdminPage)
        // instead of an uncached GET per redirect. Warm navs = 0 GETs.
        const cached = queryClient.getQueryData<any[]>(qk.admin.colleges())
        const colleges = cached ?? await adminAPI.getColleges()
        const found = (colleges as any[]).find((c) => c.id === collegeId)
        if (!cancelled) {
          if (found) {
            setSelectedCollege(found.id, found.name, found.code)
            syncLegacyStorage(found.id, found.name)
            try {
              localStorage.setItem('superadmin_selectedCollegeId', found.id)
              localStorage.setItem('superadmin_selectedCollegeName', found.name)
            } catch {}
            navigate(`/admin?collegeId=${found.id}&collegeName=${encodeURIComponent(found.name)}&tab=${tab}`, { replace: true })
          } else {
            setSelectedCollege(collegeId, collegeId, null)
            syncLegacyStorage(collegeId, collegeId)
            try { localStorage.setItem('superadmin_selectedCollegeId', collegeId) } catch {}
            navigate(`/admin?collegeId=${collegeId}&tab=${tab}`, { replace: true })
          }
        }
      } catch {
        if (!cancelled) {
          setSelectedCollege(collegeId, collegeId, null)
          syncLegacyStorage(collegeId, collegeId)
          try { localStorage.setItem('superadmin_selectedCollegeId', collegeId) } catch {}
          navigate(`/admin?collegeId=${collegeId}&tab=${tab}`, { replace: true })
        }
      }
    }
    go()
    return () => { cancelled = true }
  }, [collegeId, navigate, setSelectedCollege, searchParams])

  return (
    <div className="max-w-[1280px] mx-auto">
      <h1 className="sr-only">College View — Loading college details</h1>
      <CenteredLoader text="Loading college..." />
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, User, GraduationCap, BookOpen, Search, Building2, Library, Clock3, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import Input from '../components/ui/Input'
import Button from '../components/ui/Button'
import { useAuthStore } from '../store/authStore'
import { collegeAPI } from '../lib/api'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import { motion } from 'framer-motion'

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', collegeId: '', studentId: '', department: '', incomingYear: '' })
  const [colleges, setColleges] = useState<any[]>([])
  const [collegeSearch, setCollegeSearch] = useState('')
  const [collegeOpen, setCollegeOpen] = useState(false)
  const { register, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => { collegeAPI.getPublicList().then(setColleges).catch(()=>{}) }, [])
  const filteredColleges = colleges.filter((c) => c.name.toLowerCase().includes(collegeSearch.toLowerCase()))
  const selectedCollege = colleges.find((c) => c.id === form.collegeId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.collegeId) { toast.error('Please select your college'); return }
    try {
      const payload = { ...form, incomingYear: form.incomingYear ? parseInt(form.incomingYear) : undefined }
      await register(payload)
      toast.success('Account created!')
      navigate('/dashboard')
    } catch (err: any) { toast.error(err.message || 'Registration failed') }
  }
  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p)=>({ ...p, [field]: e.target.value }))

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-night-800 flex">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<UserPlus size={18} />}
        eyebrow="CampusFlow · Create"
        title={<>Create account</>}
        subtitle="Join your campus — fast onboarding, instant access."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      {/* Left — Quad photo */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden border-r border-surface-200 dark:border-night-600 bg-warning-100">
        <div className="absolute inset-0 rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm-grain opacity-60" />
        <div className="absolute inset-6 rounded-[14px] overflow-hidden border border-surface-200 dark:border-night-600 shadow-e2 bg-white dark:bg-night-800">
          <img src="https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&q=80&auto=format&fit=crop" alt="Library hall with arches" className="w-full h-full object-cover" loading="eager" />
          <div className="absolute bottom-4 left-4 right-4 bg-white/95 dark:bg-night-800/95 backdrop-blur rounded-xl border border-surface-200 dark:border-night-600 p-3">
            <p className="text-sm font-bold text-surface-900 dark:text-night-50">Admissions — Intake Hall</p>
            <p className="text-xs text-surface-500 dark:text-night-400">One card, every door. Fill once, carry everywhere.</p>
          </div>
        </div>
        <div className="relative z-10 mt-auto w-full p-8">
          <div className="max-w-[520px] bg-white dark:bg-night-800 rounded-[14px] border border-surface-200 dark:border-night-600 shadow-e2 p-5">
            <p className="font-display font-bold text-surface-900 dark:text-night-50">Why CampusFlow?</p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {[{num:'10K+',label:'Students'},{num:'50+',label:'Colleges'},{num:'AA',label:'WCAG'}].map(s=>(
                <div key={s.label} className="rounded-xl bg-surface-50 dark:bg-night-800 border border-surface-200 dark:border-night-600 py-3 text-center">
                  <p className="font-display font-extrabold text-surface-900 dark:text-night-50">{s.num}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400 dark:text-night-400">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right — Admission form (library card) */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-[480px] animate-slideUp">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
              <GraduationCap className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="font-display font-extrabold tracking-tight text-surface-900 dark:text-night-50 leading-none">CampusFlow</p>
              <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-surface-400 dark:text-night-400">Hall 01 · Campus OS</p>
            </div>
          </div>

          <div className="rounded-[24px] bg-white dark:bg-[#121212] border border-surface-200 dark:border-[#282828] shadow-sm overflow-hidden">
            <div className="h-[3px] bg-brass-400" />
            <div className="px-6 pt-6 pb-2">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-widest uppercase text-surface-500 dark:text-night-400 border border-surface-200 dark:border-night-600 rounded-full px-2.5 py-1">
                <Library size={12} /> Admission Card
              </div>
              <h1 className="mt-3 font-display text-[28px] leading-none font-extrabold text-surface-900 dark:text-night-50">Create your account</h1>
              <p className="mt-1.5 text-sm text-surface-500 dark:text-night-400">Your library card for every room, notice, and deadline.</p>
            </div>

            <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
              <Input label="Full Name" placeholder="Alex Johnson" icon={<User size={18} />} value={form.name} onChange={update('name')} required />
              <Input label="University Email" type="email" placeholder="you@university.edu" icon={<Mail size={18} />} value={form.email} onChange={update('email')} required />
              <Input label="Roll Number" placeholder="e.g., CS2023001" icon={<GraduationCap size={18} />} value={form.studentId} onChange={update('studentId')} required />

              <div className="relative">
                <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">College</label>
                <div className="relative">
                  <Building2 size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
                  <input
                    type="text"
                    placeholder="Search your college..."
                    value={collegeOpen ? collegeSearch : (selectedCollege?.name || '')}
                    onFocus={()=>{setCollegeOpen(true); setCollegeSearch('')}}
                    onChange={(e)=>{setCollegeSearch(e.target.value); setCollegeOpen(true)}}
                    onBlur={()=>setTimeout(()=>setCollegeOpen(false),200)}
                    className="w-full pl-10 pr-10 min-h-[44px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 placeholder:text-surface-400 dark:placeholder:text-night-400 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/20 text-sm"
                  />
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 dark:text-night-400" />
                </div>
                {collegeOpen && (
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-night-800 border border-surface-200 dark:border-night-600 rounded-xl shadow-e2 max-h-48 overflow-y-auto">
                    {filteredColleges.length===0 ? (
                      <div className="px-3 py-2 text-sm text-surface-500 dark:text-night-400">No colleges found</div>
                    ) : filteredColleges.map(college=>(
                      <button
                        key={college.id}
                        type="button"
                        onMouseDown={()=>{
                          setForm((p)=>({...p,collegeId:college.id}))
                          setCollegeSearch(''); setCollegeOpen(false)
                        }}
                        className="w-full text-left px-3 min-h-[44px] text-sm hover:bg-surface-50 dark:hover:bg-night-700 dark:bg-night-800 flex items-center gap-2 border-b last:border-0 border-surface-100 dark:border-night-600"
                      >
                        <Building2 size={14} className="text-surface-400 dark:text-night-400" /> {college.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Input label="Department" placeholder="e.g., CSE, ECE" icon={<BookOpen size={18} />} value={form.department} onChange={update('department')} required />
              <div>
                <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Year</label>
                <select value={form.incomingYear} onChange={update('incomingYear')} className="w-full px-4 min-h-[44px] rounded-xl border border-surface-200 dark:border-night-600 bg-white dark:bg-night-850 text-surface-900 dark:text-night-50 focus:outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/20 text-sm">
                  <option value="">Select year</option>
                  <option value="1">1st Year</option>
                  <option value="2">2nd Year</option>
                  <option value="3">3rd Year</option>
                  <option value="4">4th Year</option>
                </select>
              </div>
              <Input label="Password" type="password" placeholder="Create a strong password" icon={<Lock size={18} />} value={form.password} onChange={update('password')} required />
              <Button type="submit" loading={loading} className="w-full">Create Account</Button>
              <p className="text-center text-sm text-surface-500 dark:text-night-400">Already have an account? <Link to="/login" className="text-primary-600 hover:text-primary-700 font-semibold">Sign in</Link></p>
            </form>
            <div className="px-6 py-3 bg-surface-50 dark:bg-night-800 border-t border-surface-200 dark:border-night-600 flex items-center justify-between text-xs text-surface-500 dark:text-night-400">
              <span className="inline-flex items-center gap-1.5"><Clock3 size={12}/> Registrar 9—5 IST</span>
              <span className="font-mono text-[11px]">FORM CF-ADM-01</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

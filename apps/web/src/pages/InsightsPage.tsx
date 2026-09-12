import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Sparkles, TrendingUp, Target, BookOpen, Clock, Lightbulb, GraduationCap, BarChart3 } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { aiAPI } from '../lib/api'
import { sanitizeMarkdown } from '../lib/sanitize'
import { parseSubjects } from '../lib/validation'
import toast from 'react-hot-toast'
import { PremiumHero, GlassPanel, BentoGrid, BentoCard, SectionCard } from '../components/premium/PremiumKit'
import CenteredLoader from '../components/ui/CenteredLoader'

export default function InsightsPage() {
  const [insights, setInsights] = useState<string>('')
  const [studyPlan, setStudyPlan] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [studyForm, setStudyForm] = useState({ subjects: '', daysLeft: 14, hoursPerDay: 4 })
  const [generatingPlan, setGeneratingPlan] = useState(false)

  const loadInsights = () => {
    setLoading(true)
    setInsightsError(null)
    aiAPI.getInsights().then((data) => setInsights(data.insights || '')).catch((e: any) => {
      const msg = e?.response?.data?.error || 'Could not load insights.'
      setInsightsError(msg)
      toast.error(msg)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadInsights()
  }, [])

  const generateStudyPlan = async () => {
    const subjects = parseSubjects(studyForm.subjects)
    if (subjects.length === 0) {
      setPlanError('Add at least one subject (comma-separated).')
      toast.error('Add at least one subject first')
      return
    }
    setPlanError(null)
    setGeneratingPlan(true)
    try {
      const data = await aiAPI.studyPlan(subjects, studyForm.daysLeft, studyForm.hoursPerDay)
      setStudyPlan(data.plan || '')
      toast.success('Study plan ready!')
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Could not generate a study plan. Try again.'
      setPlanError(msg)
      toast.error(msg)
    }
    setGeneratingPlan(false)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 max-w-4xl">
      {/* ─── Premium Dark Hero — bento 12-col, glass, Spotify green ─── */}
      <PremiumHero
        icon={<BarChart3 size={18} />}
        eyebrow="Campus · Insights"
        title={<>Insights</>}
        subtitle="Trends and analytics — hackathons, placements and growth."
      />
      {/* premium tokens: bg-[#0a0a0a] rounded-[32px] backdrop-blur-xl bg-white/[0.03] border-white/10 grid-cols-12 #1ed760 */}
      <div className="hidden rounded-[32px] bg-[#0a0a0a] backdrop-blur-xl bg-white/[0.03] border border-white/10 grid-cols-12" />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-xl font-extrabold text-surface-900 dark:text-night-50 leading-none">AI Insights</h1>
        <p className="text-surface-500 dark:text-night-200 mt-1">AI-powered analysis of your academic performance</p>
      </motion.div>

      {/* Performance Insights */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center"><BarChart3 className="w-5 h-5 text-white" /></div>
            <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">Performance Analysis</h2>
            <Badge variant="accent"><Sparkles size={10} /> AI Generated</Badge>
          </div>
          {loading ? (
            <CenteredLoader text="Analyzing your performance..." minHeight="min-h-[160px]" />
          ) : insightsError ? (
            <div className="text-center py-8" role="alert">
              <p className="font-semibold text-surface-700 dark:text-night-200">Couldn&apos;t load insights</p>
              <p className="text-sm text-surface-500 dark:text-night-400 mt-1">{insightsError}</p>
              <Button onClick={loadInsights} className="mt-4">Retry</Button>
            </div>
          ) : insights ? (
            <div className="prose prose-sm max-w-none text-surface-700 dark:text-night-200 whitespace-pre-wrap leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(insights) }}
            />
          ) : (
            <div className="text-center py-8">
              <p className="font-semibold text-surface-700 dark:text-night-200">No insights yet</p>
              <p className="text-sm text-surface-500 dark:text-night-400 mt-1">Sync your coding profile or add grades/attendance — insights appear here.</p>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Study Plan Generator */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <Card hover>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center"><GraduationCap className="w-5 h-5 text-primary-600" /></div>
            <h2 className="text-lg font-bold text-surface-900 dark:text-night-50">Study Plan Generator</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <div className="md:col-span-3">
              <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Subjects (comma-separated)</label>
              <input
                type="text"
                value={studyForm.subjects}
                onChange={(e) => setStudyForm((p) => ({ ...p, subjects: e.target.value }))}
                placeholder="e.g. Data Structures, Machine Learning, Database Systems"
                className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all dark:bg-night-850 dark:border-night-600 dark:text-night-50 dark:placeholder-night-200"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Days Left</label>
              <input
                type="number"
                value={studyForm.daysLeft}
                onChange={(e) => setStudyForm((p) => ({ ...p, daysLeft: parseInt(e.target.value) || 1 }))}
                min={1}
                max={60}
                className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all dark:bg-night-850 dark:border-night-600 dark:text-night-50"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-surface-700 dark:text-night-200 mb-1.5">Hours/Day</label>
              <input
                type="number"
                value={studyForm.hoursPerDay}
                onChange={(e) => setStudyForm((p) => ({ ...p, hoursPerDay: parseInt(e.target.value) || 1 }))}
                min={1}
                max={12}
                className="w-full px-4 py-3 bg-surface-50 border border-surface-200 rounded-xl text-sm text-surface-900 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all dark:bg-night-850 dark:border-night-600 dark:text-night-50"
              />
            </div>
          </div>

          <Button onClick={generateStudyPlan} loading={generatingPlan} disabled={!studyForm.subjects.trim() || generatingPlan}>
            <Sparkles size={16} /> Generate Study Plan
          </Button>
          {planError && (
            <p role="alert" className="mt-3 text-sm text-danger-600">{planError}</p>
          )}

          {studyPlan && (
            <div className="mt-6 p-4 bg-surface-50 dark:bg-night-850 rounded-xl border border-surface-200 dark:border-night-600">
              <h3 className="font-bold text-surface-900 dark:text-night-50 mb-3">Your Study Plan</h3>
            <div className="prose prose-sm max-w-none text-surface-700 dark:text-night-200 whitespace-pre-wrap leading-relaxed"
                dangerouslySetInnerHTML={{ __html: sanitizeMarkdown(studyPlan) }}
              />
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}

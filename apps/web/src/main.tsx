import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { HelmetProvider } from 'react-helmet-async'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { LanguageProvider } from './i18n/LanguageContext'
import { queryClient } from './lib/queryClient'
import { initWebVitals } from './lib/webVitals'
import './index.css'

// RUM: LCP/CLS/INP/FCP/TTFB via native observers (0KB, no web-vitals dep).
// Reports to VITE_RUM_ENDPOINT when set, otherwise console.debug only.
try {
  if (document.readyState === 'complete') initWebVitals()
  else window.addEventListener('load', () => initWebVitals(), { once: true })
  // Fallback: init on next tick so SPA nav still captures LCP.
  setTimeout(() => { try { initWebVitals() } catch {} }, 3000)
} catch {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* WHY: respect OS reduced-motion globally (WCAG 2.3.3) — all motion.div respect user setting unless explicitly overridden. */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <HelmetProvider>
          <ThemeProvider>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </ThemeProvider>
        </HelmetProvider>
      </QueryClientProvider>
    </MotionConfig>
  </React.StrictMode>,
)
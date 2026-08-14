# CampusFlow UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform CampusFlow from generic SaaS to Premium Minimal design (Linear/Stripe/Vercel aesthetic) with dark mode support.

**Architecture:** CSS custom properties for theming, Tailwind config updates, component-level styling changes. No new dependencies needed.

**Tech Stack:** React, Tailwind CSS, CSS Custom Properties, Framer Motion (existing)

## Global Constraints

- No new npm dependencies
- Maintain all existing functionality
- Dark mode must work on first load (respect system preference)
- All changes are in `apps/web/` directory
- Test on both light and dark modes

---

### Task 1: Tailwind Config & CSS Variables

**Files:**
- Modify: `apps/web/tailwind.config.js`
- Modify: `apps/web/src/index.css`

**Interfaces:**
- Consumes: None (foundation task)
- Produces: New color tokens, dark mode support, CSS variables

- [ ] **Step 1: Update tailwind.config.js with new color palette**

```javascript
// apps/web/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FAFBFC',
          100: '#F1F3F5',
          200: '#E4E7EC',
          300: '#C1C8D1',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#52525B',
          700: '#3F3F46',
          800: '#27272A',
          900: '#18181B',
          950: '#09090B',
        },
        accent: {
          50: '#F5F3FF',
          100: '#EDE9FE',
          200: '#DDD6FE',
          300: '#C4B5FD',
          400: '#A78BFA',
          500: '#8B5CF6',
          600: '#7C3AED',
          700: '#6D28D9',
          800: '#5B21B6',
          900: '#4C1D95',
        },
        surface: {
          50: '#FAFBFC',
          100: '#F1F3F5',
          200: '#E4E7EC',
          300: '#C1C8D1',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#52525B',
          700: '#3F3F46',
          800: '#27272A',
          900: '#18181B',
          950: '#09090B',
        },
        success: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#059669',
          600: '#047857',
          700: '#047857',
        },
        warning: {
          50: '#FFFBEB',
          100: '#FEF3C7',
          500: '#D97706',
          600: '#B45309',
          700: '#B45309',
        },
        error: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          500: '#DC2626',
          600: '#B91C1C',
          700: '#B91C1C',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        'sm': '6px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
      },
      boxShadow: {
        'none': 'none',
        'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        'lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 2: Update index.css with CSS custom properties and dark mode**

```css
/* apps/web/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --bg-primary: #FAFBFC;
    --bg-surface: #FFFFFF;
    --bg-elevated: #FFFFFF;
    --border-default: #E4E7EC;
    --border-subtle: #F1F3F5;
    --text-primary: #09090B;
    --text-secondary: #71717A;
    --text-tertiary: #A1A1AA;
    --accent: #6D28D9;
    --accent-hover: #5B21B6;
    --accent-subtle: #F5F3FF;
    --success: #059669;
    --warning: #D97706;
    --error: #DC2626;
  }

  [data-theme="dark"] {
    --bg-primary: #09090B;
    --bg-surface: #18181B;
    --bg-elevated: #27272A;
    --border-default: #27272A;
    --border-subtle: #1F1F23;
    --text-primary: #FAFAFA;
    --text-secondary: #A1A1AA;
    --text-tertiary: #71717A;
    --accent: #8B5CF6;
    --accent-hover: #A78BFA;
    --accent-subtle: #1E1B2E;
    --success: #10B981;
    --warning: #F59E0B;
    --error: #EF4444;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg-primary: #09090B;
      --bg-surface: #18181B;
      --bg-elevated: #27272A;
      --border-default: #27272A;
      --border-subtle: #1F1F23;
      --text-primary: #FAFAFA;
      --text-secondary: #A1A1AA;
      --text-tertiary: #71717A;
      --accent: #8B5CF6;
      --accent-hover: #A78BFA;
      --accent-subtle: #1E1B2E;
      --success: #10B981;
      --warning: #F59E0B;
      --error: #EF4444;
    }
  }

  * {
    border-color: var(--border-default);
  }

  body {
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: var(--border-default);
    border-radius: 3px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
  }
}

@layer components {
  .btn-primary {
    @apply inline-flex items-center justify-center font-medium rounded-md transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100;
    background-color: var(--text-primary);
    color: white;
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .btn-primary:hover {
    opacity: 0.9;
  }

  .btn-secondary {
    @apply inline-flex items-center justify-center font-medium rounded-md transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-default);
    color: var(--text-primary);
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .btn-secondary:hover {
    background-color: var(--bg-primary);
  }

  .btn-ghost {
    @apply inline-flex items-center justify-center font-medium rounded-md transition-all duration-150;
    background: transparent;
    color: var(--text-secondary);
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .btn-ghost:hover {
    background-color: var(--bg-primary);
    color: var(--text-primary);
  }

  .btn-danger {
    @apply inline-flex items-center justify-center font-medium rounded-md transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100;
    background-color: var(--error);
    color: white;
    height: 40px;
    padding: 0 16px;
    font-size: 14px;
  }

  .btn-danger:hover {
    background-color: #B91C1C;
  }

  .card {
    background-color: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 12px;
    padding: 24px;
    transition: border-color 200ms, box-shadow 200ms;
  }

  .card-interactive {
    @apply card cursor-pointer;
  }

  .card-interactive:hover {
    border-color: var(--border-subtle);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .input-field {
    @apply w-full rounded-md transition-all duration-150;
    background-color: var(--bg-surface);
    border: 1px solid var(--border-default);
    height: 40px;
    padding: 0 12px;
    font-size: 14px;
    color: var(--text-primary);
  }

  .input-field:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
  }

  .input-field::placeholder {
    color: var(--text-tertiary);
  }

  .badge {
    @apply inline-flex items-center font-medium;
    background-color: var(--bg-primary);
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 500;
  }

  .badge-success {
    background-color: #ECFDF5;
    color: #059669;
    border-color: #A7F3D0;
  }

  .badge-warning {
    background-color: #FFFBEB;
    color: #D97706;
    border-color: #FDE68A;
  }

  .badge-error {
    background-color: #FEF2F2;
    color: #DC2626;
    border-color: #FECACA;
  }

  .sidebar-link {
    @apply flex items-center gap-3 font-medium transition-all duration-200;
    padding: 8px 12px;
    border-radius: 8px;
    color: var(--text-secondary);
    font-size: 14px;
  }

  .sidebar-link:hover {
    background-color: var(--bg-primary);
    color: var(--text-primary);
  }

  .sidebar-link-active {
    @apply flex items-center gap-3 font-medium transition-all duration-200;
    padding: 8px 12px;
    border-radius: 8px;
    background-color: var(--accent-subtle);
    color: var(--accent);
    font-size: 14px;
    border-left: 2px solid var(--accent);
  }

  .gradient-text {
    @apply bg-clip-text text-transparent;
    background-image: linear-gradient(135deg, var(--accent) 0%, var(--accent-hover) 100%);
  }

  .glass {
    @apply backdrop-blur-xl;
    background-color: rgba(255, 255, 255, 0.8);
    border: 1px solid var(--border-default);
  }

  .glass-dark {
    @apply backdrop-blur-xl;
    background-color: rgba(24, 24, 27, 0.8);
    border: 1px solid var(--border-default);
  }

  .dot-pattern {
    background-image: radial-gradient(circle, var(--border-default) 1px, transparent 1px);
    background-size: 20px 20px;
  }

  .page-enter {
    @apply animate-fade-in;
  }

  .hover-lift {
    @apply transition-all duration-200;
  }

  .hover-lift:hover {
    transform: translateY(-1px);
  }
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }

  .animate-fade-in {
    animation: fadeIn 150ms ease-out;
  }

  .animate-slide-up {
    animation: slideUp 200ms ease-out;
  }

  .animate-slide-down {
    animation: slideDown 150ms ease-out;
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Print styles */
@media print {
  .h-screen, .flex-1 { height: auto !important; }
  .overflow-hidden, .overflow-y-auto { overflow: visible !important; }
  aside, header, nav, .print\:hidden, .fixed { display: none !important; }
  .rounded-lg, .rounded-xl, .rounded-2xl { border-radius: 4px !important; }
  .shadow-sm, .shadow-md, .shadow-lg { box-shadow: none !important; }
  .bg-white { break-inside: avoid; page-break-inside: avoid; }
  h1 { font-size: 20pt !important; margin-bottom: 8pt !important; }
  h2 { font-size: 14pt !important; margin-top: 12pt !important; margin-bottom: 6pt !important; }
}
```

- [ ] **Step 3: Verify build works**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/tailwind.config.js apps/web/src/index.css
git commit -m "feat: update tailwind config and CSS for premium minimal design"
```

---

### Task 2: UI Components Redesign

**Files:**
- Modify: `apps/web/src/components/ui/Button.tsx`
- Modify: `apps/web/src/components/ui/Card.tsx`
- Modify: `apps/web/src/components/ui/Input.tsx`
- Modify: `apps/web/src/components/ui/Badge.tsx`
- Modify: `apps/web/src/components/ui/Modal.tsx`

**Interfaces:**
- Consumes: CSS classes from Task 1
- Produces: Updated component styling

- [ ] **Step 1: Update Button.tsx**

```tsx
// apps/web/src/components/ui/Button.tsx
import clsx from 'clsx'
import { forwardRef } from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={clsx(
          'inline-flex items-center justify-center font-medium rounded-md transition-all duration-150 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
          {
            'bg-primary-950 text-white hover:bg-primary-900': variant === 'primary',
            'bg-white border border-primary-200 text-primary-950 hover:bg-primary-50': variant === 'secondary',
            'text-primary-500 hover:bg-primary-50 hover:text-primary-950': variant === 'ghost',
            'bg-error-500 text-white hover:bg-error-600': variant === 'danger',
          },
          {
            'h-8 px-3 text-xs gap-1.5': size === 'sm',
            'h-10 px-4 text-sm gap-2': size === 'md',
            'h-12 px-6 text-base gap-2.5': size === 'lg',
          },
          className
        )}
        {...props}
      >
        {loading ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : icon ? (
          icon
        ) : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
export default Button
```

- [ ] **Step 2: Update Card.tsx**

```tsx
// apps/web/src/components/ui/Card.tsx
import clsx from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

export default function Card({ children, className, hover = false, padding = 'md', onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'bg-white rounded-xl border border-primary-200',
        {
          'transition-all duration-200 hover:border-primary-300 hover:shadow-sm': hover,
          'p-0': padding === 'none',
          'p-4': padding === 'sm',
          'p-6': padding === 'md',
          'p-8': padding === 'lg',
          'cursor-pointer': hover && onClick,
        },
        className
      )}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Update Input.tsx**

```tsx
// apps/web/src/components/ui/Input.tsx
import clsx from 'clsx'
import { forwardRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, type, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false)
    const isPassword = type === 'password'

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-primary-700">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-primary-400">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            type={isPassword && showPassword ? 'text' : type}
            className={clsx(
              'w-full bg-white border border-primary-200 rounded-md text-primary-950 placeholder-primary-400',
              'focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/10',
              'transition-all duration-150',
              {
                'h-10 px-3': !icon,
                'h-10 pl-10 pr-3': icon,
                'pr-10': isPassword,
                'border-error-500 focus:border-error-500 focus:ring-error-500/10': error,
              },
              className
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-400 hover:text-primary-600 transition-colors"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-error-500">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export default Input
```

- [ ] **Step 4: Update Badge.tsx**

```tsx
// apps/web/src/components/ui/Badge.tsx
import clsx from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'accent'
  className?: string
}

export default function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center font-medium text-xs',
        {
          'bg-primary-50 text-primary-600 border border-primary-200': variant === 'default',
          'bg-success-50 text-success-500 border border-success-100': variant === 'success',
          'bg-warning-50 text-warning-500 border border-warning-100': variant === 'warning',
          'bg-error-50 text-error-500 border border-error-100': variant === 'error',
          'bg-accent-50 text-accent-600 border border-accent-200': variant === 'accent',
        },
        'rounded-md px-2 py-0.5',
        className
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 5: Update Modal.tsx**

```tsx
// apps/web/src/components/ui/Modal.tsx
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export default function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div
        className={clsx(
          'bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-fade-in',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-primary-200">
            <h2 className="text-lg font-semibold text-primary-950">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-primary-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify build works**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/
git commit -m "feat: redesign UI components for premium minimal style"
```

---

### Task 3: Layout Component Redesign

**Files:**
- Modify: `apps/web/src/components/layout/Layout.tsx`

**Interfaces:**
- Consumes: CSS classes from Task 1, updated components from Task 2
- Produces: Redesigned sidebar and top bar

- [ ] **Step 1: Update Layout.tsx with new sidebar and top bar**

```tsx
// apps/web/src/components/layout/Layout.tsx
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import {
  LayoutDashboard, Calendar, MessageSquare, BookOpen,
  Bell, Settings, LogOut, Menu, X, GraduationCap,
  ChevronRight, Search, Award, Target, Clock, Trophy,
  ClipboardList, Shield, DoorOpen, Briefcase, Code, Lightbulb, CheckSquare, Sun, Moon
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { motion, AnimatePresence } from 'framer-motion'
import CommandPalette from '../CommandPalette'
import { timetableAPI, hackathonAPI, formAPI, roomAPI, internshipAPI, codingContestAPI, codingProfileAPI } from '../../lib/api'

const navByRole: Record<string, any[]> = {
  STUDENT: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/schedule', label: 'Timetable', icon: Calendar },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/internships', label: 'Internships', icon: Briefcase },
    { path: '/contests', label: 'Contests', icon: Code },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    { path: '/chat', label: 'AI Assistant', icon: MessageSquare },
    { path: '/assignments', label: 'Assignments', icon: BookOpen },
    { path: '/grades', label: 'Grades', icon: Award },
    { path: '/attendance', label: 'Attendance', icon: Target },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  TEACHER: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/schedule', label: 'Timetable', icon: Calendar },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/internships', label: 'Internships', icon: Briefcase },
    { path: '/teacher/opportunities', label: 'Assigned to Me', icon: CheckSquare },
    { path: '/contests', label: 'Contests', icon: Code },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    { path: '/chat', label: 'AI Assistant', icon: MessageSquare },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  COLLEGE_ADMIN: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin', label: 'Admin Panel', icon: Shield },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/internships', label: 'Internships', icon: Briefcase },
    { path: '/admin/opportunities', label: 'Review Opportunities', icon: CheckSquare },
    { path: '/contests', label: 'Contests', icon: Code },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
  SUPER_ADMIN: [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/admin', label: 'Admin Panel', icon: Shield },
    { path: '/hackathons', label: 'Hackathons', icon: Trophy },
    { path: '/internships', label: 'Internships', icon: Briefcase },
    { path: '/admin/opportunities', label: 'Review Opportunities', icon: CheckSquare },
    { path: '/contests', label: 'Contests', icon: Code },
    { path: '/forms', label: 'Forms', icon: ClipboardList },
    { path: '/rooms', label: 'Rooms', icon: DoorOpen },
    { path: '/settings', label: 'Settings', icon: Settings },
  ],
}

export default function Layout() {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [todayClasses, setTodayClasses] = useState<any[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [nearDeadlineCount, setNearDeadlineCount] = useState({ hackathons: 0, forms: 0, internships: 0, contests: 0 })
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showProfileNudge, setShowProfileNudge] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme')
      if (saved === 'dark' || saved === 'light') return saved
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  // Load today's classes
  useEffect(() => {
    timetableAPI.getToday().then(setTodayClasses).catch(() => {})
  }, [])

  // Update clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // Refresh classes when navigating
  useEffect(() => {
    timetableAPI.getToday().then(setTodayClasses).catch(() => {})
  }, [location.pathname])

  // Fetch near-deadline counts for hackathons, forms, internships & contests
  useEffect(() => {
    const isNear = (dateStr: string) => {
      if (!dateStr) return false
      const diff = new Date(dateStr).getTime() - Date.now()
      return diff > 0 && diff <= 3 * 24 * 60 * 60 * 1000
    }
    hackathonAPI.getAll().then((data) => {
      const count = data.filter((h: any) => isNear(h.deadline)).length
      setNearDeadlineCount((prev) => ({ ...prev, hackathons: count }))
    }).catch(() => {})
    formAPI.getAll().then((data) => {
      const count = data.filter((f: any) => isNear(f.expiresAt)).length
      setNearDeadlineCount((prev) => ({ ...prev, forms: count }))
    }).catch(() => {})
    internshipAPI.getAll().then((data) => {
      const count = data.filter((i: any) => i.status === 'ACTIVE' && i.deadline && isNear(i.deadline)).length
      setNearDeadlineCount((prev) => ({ ...prev, internships: count }))
    }).catch(() => {})
    codingContestAPI.getAll().then((data) => {
      const now = new Date()
      const count = data.filter((c: any) => {
        if (!c.startTime) return false
        const start = new Date(c.startTime)
        const end = new Date(start.getTime() + (c.duration || 180) * 60000)
        return now >= start && now <= end
      }).length
      setNearDeadlineCount((prev) => ({ ...prev, contests: count }))
    }).catch(() => {})
  }, [location.pathname])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Load notifications for students
  useEffect(() => {
    if (user?.role === 'STUDENT') {
      roomAPI.getNotifications().then(setNotifications).catch(() => {})
    }
  }, [user?.role, location.pathname])

  // Check if student has coding profiles for nudge banner
  useEffect(() => {
    if (user?.role === 'STUDENT') {
      codingProfileAPI.get().then((profile) => {
        const hasAny = profile?.leetcodeHandle || profile?.codeforcesHandle || 
                       profile?.codechefHandle || profile?.hackerrankHandle || profile?.gfgHandle
        if (!hasAny) setShowProfileNudge(true)
      }).catch(() => {})
    }
  }, [user])

  const unreadCount = notifications.filter(n => !n.isRead).length

  const handleLogout = () => { logout(); navigate('/login') }

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const hour = h > 12 ? h - 12 : h
    return `${hour}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
  }

  const now = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-950 flex items-center justify-center">
          <GraduationCap className="w-6 h-6 text-white" />
        </div>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
            <span className="text-lg font-semibold text-primary-950">CampusFlow</span>
            <p className="text-xs text-primary-500 font-medium">AI Campus OS</p>
          </motion.div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1 mt-1">
        {(navByRole[user?.role || 'STUDENT'] || navByRole.STUDENT).map((item) => {
          const isActive = location.pathname === item.path
          const Icon = item.icon
          const nearCount = item.path === '/hackathons' ? nearDeadlineCount.hackathons
            : item.path === '/forms' ? nearDeadlineCount.forms
            : item.path === '/internships' ? nearDeadlineCount.internships
            : item.path === '/contests' ? nearDeadlineCount.contests
            : 0
          return (
            <button key={item.path} onClick={() => navigate(item.path)} title={item.label}
              className={clsx('w-full flex items-center gap-3 rounded-md font-medium transition-all duration-150 group relative',
                sidebarOpen ? 'px-3 py-2' : 'justify-center px-0 py-2',
                isActive ? 'bg-accent-50 text-accent-600 border-l-2 border-accent-500' : 'text-primary-500 hover:bg-primary-50 hover:text-primary-950'
              )}>
              <Icon size={18} className={isActive ? 'text-accent-500' : 'text-primary-400 group-hover:text-primary-600'} />
              {sidebarOpen && <span className="flex-1 text-left text-sm">{item.label}</span>}
              {sidebarOpen && nearCount > 0 && (
                <span className="px-1.5 py-0.5 bg-error-500 text-white text-[10px] font-bold rounded-full min-w-[18px] text-center">{nearCount}</span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 mt-auto pb-3">
        <div className={clsx('flex items-center gap-3', !sidebarOpen && 'justify-center')}>
          <div className="w-9 h-9 rounded-lg bg-primary-950 flex items-center justify-center text-white font-bold text-xs">
            {user?.name?.charAt(0) || 'S'}
          </div>
          {sidebarOpen && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-primary-950 truncate">{user?.name || 'Student'}</p>
                <p className="text-xs text-primary-500 truncate">{user?.email || 'student@campus.edu'}</p>
              </div>
              <button onClick={handleLogout} className="p-1.5 rounded-md text-primary-400 hover:text-error-500 hover:bg-error-50 transition-all" title="Logout">
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-primary-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className={clsx('hidden lg:flex flex-col border-r border-primary-200 bg-white transition-all duration-200 overflow-hidden', sidebarOpen ? 'w-60' : 'w-16')}>
        <SidebarContent />
      </aside>

      {/* Coding Profile Nudge Banner */}
      {showProfileNudge && (
        <div className="bg-primary-950 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code size={16} />
            <span className="text-sm font-medium">Add your coding profiles to track contest participation!</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/settings')} className="px-3 py-1 bg-white/10 rounded-md text-sm font-medium hover:bg-white/20">
              Add Now
            </button>
            <button onClick={() => setShowProfileNudge(false)} className="px-3 py-1 text-white/70 hover:text-white text-sm">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 25, stiffness: 300 }} className="fixed inset-y-0 left-0 w-64 bg-white z-50 lg:hidden shadow-xl">
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 p-2 rounded-md text-primary-400 hover:bg-primary-50"><X size={20} /></button>
              <SidebarContent />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-primary-200 flex items-center px-4 lg:px-6 gap-4 shrink-0 z-30 bg-white">
          <button onClick={() => window.innerWidth >= 1024 ? setSidebarOpen(!sidebarOpen) : setMobileOpen(true)} className="p-2 rounded-md text-primary-500 hover:bg-primary-50 transition-colors">
            {sidebarOpen && window.innerWidth >= 1024 ? <X size={18} /> : <Menu size={18} />}
          </button>

          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-primary-400" size={16} />
            <input type="text" placeholder="Search... (⌘K)" className="w-full pl-10 pr-4 py-2 bg-primary-50 border border-primary-200 rounded-md text-sm text-primary-950 placeholder-primary-400 focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/10 transition-all" readOnly onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))} />
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2 rounded-md text-primary-500 hover:bg-primary-50 transition-colors">
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="relative p-2 rounded-md text-primary-500 hover:bg-primary-50 transition-colors" onClick={() => navigate('/notifications')}>
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-error-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-2 pl-2 ml-2 border-l border-primary-200">
              <div className="w-7 h-7 rounded-md bg-primary-950 flex items-center justify-center text-white font-bold text-[10px]">{user?.name?.charAt(0) || 'S'}</div>
              <span className="text-sm font-medium text-primary-700 hidden md:block">{user?.name?.split(' ')[0]}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="p-4 lg:p-8 max-w-[1200px] mx-auto w-full">
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build works**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/Layout.tsx
git commit -m "feat: redesign layout with new sidebar and dark mode toggle"
```

---

### Task 4: Dashboard & Login Page Redesign

**Files:**
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: Updated components from Tasks 1-3
- Produces: Redesigned dashboard and login pages

- [ ] **Step 1: Update StatCard component**

```tsx
// apps/web/src/components/shared/StatCard.tsx
import { type LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  bg: string
  loading?: boolean
}

export default function StatCard({ label, value, icon: Icon, color, bg, loading }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-primary-200 p-5 flex items-center justify-between transition-all duration-200 hover:border-primary-300 hover:shadow-sm">
      <div>
        <p className="text-sm font-medium text-primary-500">{label}</p>
        <p className="text-2xl font-semibold text-primary-950 mt-1">{loading ? '—' : value}</p>
      </div>
      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: bg }}>
        <Icon size={20} style={{ color }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update PageHeader component**

```tsx
// apps/web/src/components/shared/PageHeader.tsx
interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-[30px] font-semibold text-primary-950 tracking-tight">{title}</h1>
        {subtitle && <p className="text-primary-500 text-sm mt-1">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Update FilterTabs component**

```tsx
// apps/web/src/components/shared/FilterTabs.tsx
import clsx from 'clsx'
import { type LucideIcon } from 'lucide-react'

interface Tab {
  key: string
  label: string
  icon: LucideIcon
  count?: number
}

interface FilterTabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (key: string) => void
}

export default function FilterTabs({ tabs, activeTab, onTabChange }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tabs.map(({ key, label, icon: Icon, count }) => (
        <button
          key={key}
          onClick={() => onTabChange(key)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150',
            activeTab === key
              ? 'bg-primary-950 text-white'
              : 'text-primary-500 hover:bg-primary-50 hover:text-primary-950'
          )}
        >
          <Icon size={14} />
          {label}
          {count !== undefined && (
            <span className={clsx(
              'ml-1 px-1.5 py-0.5 rounded text-xs',
              activeTab === key ? 'bg-white/20' : 'bg-primary-100'
            )}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Update DashboardPage.tsx**

Replace the entire DashboardPage with updated styling - remove gradients, emojis, simplify card layouts. Key changes:
- Remove `👋` emoji from greeting
- Use solid color stat icons (no gradient backgrounds)
- Clean schedule cards without colored left borders
- Simple quick actions grid
- No gradient quick actions card

```tsx
// apps/web/src/pages/DashboardPage.tsx - Key changes only
// Remove all gradient backgrounds from stat cards
// Remove emoji from greeting
// Clean card styling

// In stat definitions, change:
{ label: 'CGPA', value: data?.cgpa?.toFixed(1) || '—', icon: TrendingUp, color: '#059669', bg: '#ECFDF5' }
// Instead of: color: 'from-emerald-400 to-emerald-600', bg: 'bg-emerald-50'

// In greeting:
<h1 className="text-[30px] font-semibold text-primary-950 tracking-tight">
  {greeting}, {user?.name?.split(' ')[0] || 'Student'}
</h1>
// Remove the emoji and gradient-text class
```

- [ ] **Step 5: Update LoginPage.tsx**

```tsx
// apps/web/src/pages/LoginPage.tsx - Key changes
// Hero section: Replace gradient with near-black
<div className="hidden lg:flex flex-1 relative overflow-hidden bg-primary-950">
  <div className="absolute inset-0 dot-pattern opacity-5" />
  {/* Keep floating elements but make them subtler */}
  <div className="absolute top-20 left-20 w-72 h-72 bg-accent-500/10 rounded-full blur-3xl" />
  <div className="absolute bottom-20 right-20 w-96 h-96 bg-accent-400/10 rounded-full blur-3xl" />
  
  {/* Update feature cards to solid dark style */}
  <div className="p-4 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10">
    <feature.icon className="w-8 h-8 mb-3 text-white/90" />
    <p className="font-medium text-sm">{feature.label}</p>
    <p className="text-xs text-white/50">{feature.desc}</p>
  </div>
</div>

// Logo: Remove gradient
<div className="w-12 h-12 rounded-xl bg-primary-950 flex items-center justify-center">
  <GraduationCap className="w-7 h-7 text-white" />
</div>
// Remove shadow-glow class
```

- [ ] **Step 6: Verify build works**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/LoginPage.tsx apps/web/src/components/shared/
git commit -m "feat: redesign dashboard and login pages for premium minimal style"
```

---

### Task 5: Hackathons & Internships Pages

**Files:**
- Modify: `apps/web/src/pages/HackathonsPage.tsx`
- Modify: `apps/web/src/pages/InternshipsPage.tsx`

**Interfaces:**
- Consumes: Updated components from Tasks 1-4
- Produces: Redesigned list pages

- [ ] **Step 1: Update HackathonsPage.tsx**

Key changes:
- Remove gradient from create button
- Clean card styling
- Subtle status indicators

```tsx
// apps/web/src/pages/HackathonsPage.tsx - Key changes

// Create button - change from gradient to solid:
<button
  onClick={createModal.open}
  className="flex items-center gap-2 px-4 py-2 bg-primary-950 text-white rounded-md hover:bg-primary-900 transition-all text-sm font-medium"
>
  <Plus size={16} /> Create Hackathon
</button>

// Export button - simplify:
<button
  onClick={() => hackathonAPI.exportAll()}
  className="flex items-center gap-2 px-4 py-2 bg-white border border-primary-200 text-primary-700 rounded-md hover:bg-primary-50 transition-all text-sm font-medium"
>
  <Download size={16} /> Export All
</button>

// Card styling - remove hover:shadow-lg, keep border transition:
className="bg-white rounded-xl border border-primary-200 p-5 hover:border-primary-300 transition-all cursor-pointer group"
```

- [ ] **Step 2: Update InternshipsPage.tsx**

Same pattern as Hackathons:
- Solid create button
- Clean card styling
- Consistent spacing

- [ ] **Step 3: Verify build works**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/HackathonsPage.tsx apps/web/src/pages/InternshipsPage.tsx
git commit -m "feat: redesign hackathons and internships pages"
```

---

### Task 6: Remaining Pages & Final Polish

**Files:**
- Modify: All remaining page files in `apps/web/src/pages/`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Consistent styling across all pages

- [ ] **Step 1: Update remaining pages with consistent patterns**

Apply these changes to all remaining pages:
- Replace gradient buttons with solid `bg-primary-950`
- Remove all `shadow-lg`, `shadow-xl` (use `shadow-sm` only on hover)
- Update card borders to `border-primary-200`
- Remove any remaining gradient backgrounds
- Ensure consistent spacing (p-6 for cards, gap-6 for grids)

- [ ] **Step 2: Update SettingsPage.tsx with theme toggle**

Ensure the Settings page has a clear theme switching section if not already present.

- [ ] **Step 3: Final build verification**

Run: `cd apps/web && npm run build`
Expected: Build succeeds with no errors, no warnings

- [ ] **Step 4: Test dark mode**

1. Open the app in browser
2. Click the sun/moon icon in top bar
3. Verify all components render correctly in dark mode
4. Refresh page - verify theme persists

- [ ] **Step 5: Final commit**

```bash
git add apps/web/src/
git commit -m "feat: complete UI/UX redesign for premium minimal aesthetic"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] All pages use consistent color palette
- [ ] No gradient buttons remain (except sidebar brand mark)
- [ ] Dark mode works on all pages
- [ ] Theme persists across page reloads
- [ ] All animations are subtle (fade only)
- [ ] Typography uses font-semibold (not bold)
- [ ] Cards have consistent 12px border-radius
- [ ] Buttons have consistent 8px border-radius
- [ ] Focus states are visible and accessible
- [ ] Mobile responsive at all breakpoints
- [ ] No visual regressions in functionality

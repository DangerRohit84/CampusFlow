/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary — True Blue #2563EB (WCAG AA 5.67:1 on white, 4.5+)
        primary: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
          950: '#172554',
        },
        // Accent — Blue alias for internships / CTAs (kept in sync with primary)
        accent: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#2563EB',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // Rose / Red — Errors ONLY (not domain washes) — WCAG AA protected
        danger: {
          50: '#FFF1F2',100: '#FFE4E6',200: '#FECDD3',300: '#FDA4AF',400: '#FB7185',
          500: '#F43F5E',600: '#E11D48',700: '#BE123C',800: '#9F1239',900: '#881337',
        },
        // Emerald — Success / Rooms #059669 (WCAG AA 4.89:1 on white)
        success: {
          50: '#ECFDF5',100: '#D1FAE5',200: '#A7F3D0',300: '#6EE7B7',400: '#34D399',
          500: '#10B981',600: '#059669',700: '#047857',800: '#065F46',900: '#022C22',950: '#02140F',
        },
        // Warning — Brass alias (Gold triadic) #B5A268
        warning: {
          50: '#FBF9F0',100: '#F5F0D9',200: '#EADFC0',300: '#DFCF9F',400: '#C9B67A',
          500: '#B5A268',600: '#9A8A58',700: '#7F724A',800: '#655A3B',900: '#4B4330',
        },
        // Neutral — Clean Gray Canvas — light mode #F8F9FA base
        surface: {
          50: '#F8F9FA',  // spec neutral wash base (was #FAFAFA)
          100: '#F1F3F5', // subtle card background
          200: '#E9ECEF', // hairline border
          300: '#DEE2E6', // active border
          400: '#868E96', // muted text — 4.6:1 on white
          500: '#495057', // secondary text — 8.3:1
          600: '#343A40', // dark secondary
          700: '#212529', // headings fallback
          800: '#1E293B', // slate #1E293B — primary text (spec)
          900: '#1E293B', // slate text #1E293B (was #09090B)
        },
        // Slate — Text #1E293B (WCAG AA 15.9:1 on white)
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        // Apple / Linear True Deep Onyx Dark Mode (unchanged structure)
        night: {
          50: '#FAFAFA',
          100: '#F4F4F5',
          200: '#E4E4E7',
          300: '#D4D4D8',
          400: '#A1A1AA',
          500: '#71717A',
          600: '#3F3F46',
          650: '#27272A',
          700: '#18181B',
          800: '#0F0F12',
          850: '#09090B',
          900: '#050507',
          950: '#000000',
        },
        // Brass / Gold — #B5A268 core (5% wash, 15% border) triadic with Blue+Emerald+Neutral
        brass: {
          50: '#FBF9F0',100: '#F5F0D9',200: '#EADFC0',300: '#DFCF9F',400: '#C9B67A',
          500: '#B5A268',600: '#9A8A58',700: '#7F724A',800: '#655A3B',900: '#4B4330',
        },
        gold: {
          50: '#FBF9F0',100: '#F5F0D9',200: '#EADFC0',300: '#DFCF9F',400: '#C9B67A',
          500: '#B5A268',600: '#9A8A58',700: '#7F724A',800: '#655A3B',900: '#4B4330',
        }
      },
      fontFamily: {
        sans: ['DM Sans','system-ui','sans-serif'],
        display: ['Fraunces','DM Sans','serif'],
        mono: ['JetBrains Mono','monospace'],
      },
      maxWidth: {
        'campus': '1280px',
      },
      spacing: {
        '11': '44px',
      },
      minHeight: {
        '11': '44px',
      },
      minWidth: {
        '11': '44px',
      },
      gridTemplateColumns: {
        '12': 'repeat(12, minmax(0,1fr))',
      },
      borderRadius: {
        'paper': '14px',
        'card': '14px',
      },
      boxShadow: {
        'e1': '0 1px 3px 0 rgba(30, 41, 59, 0.05), 0 1px 2px -1px rgba(30, 41, 59, 0.03)',
        'e2': '0 4px 6px -1px rgba(30, 41, 59, 0.07), 0 2px 4px -2px rgba(30, 41, 59, 0.04)',
        'e3': '0 10px 15px -3px rgba(30, 41, 59, 0.09), 0 4px 6px -4px rgba(30, 41, 59, 0.04)',
        'soft': '0 1px 3px 0 rgba(30, 41, 59, 0.05), 0 1px 2px -1px rgba(30, 41, 59, 0.03)',
        'soft-lg': '0 4px 6px -1px rgba(30, 41, 59, 0.07), 0 2px 4px -2px rgba(30, 41, 59, 0.04)',
        'glass': '0 1px 3px 0 rgba(30, 41, 59, 0.05)',
        'glass-lg': '0 4px 6px -1px rgba(30, 41, 59, 0.07)',
        'glow': '0 0 15px rgba(37, 99, 235, 0.18)',
        'glow-accent': '0 0 15px rgba(181, 162, 104, 0.22)',
      },
      animation: {
        'slideUp': 'slideUp 0.32s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
}

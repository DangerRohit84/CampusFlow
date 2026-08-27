/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── FOREST QUAD — primary (campus-native, WCAG AA) ──
        primary: {
          50: '#EAF2EC',   // mint wash — bg tints
          100: '#D1E2D6',
          200: '#A8C2B3',
          300: '#7BA290',
          400: '#4C7E64',  // muted forest
          500: '#2D6A4F',  // main CTA — 6.4:1 on white, white text 6.4:1 on bg
          600: '#1B4332',  // deep forest — 11:1 on white/parchment
          700: '#143129',
          800: '#0F241E',
          900: '#0A1814',
        },
        // ── BRICK — accent (warm secondary, replaces SaaS violet) ──
        accent: {
          50: '#FDF0E8',
          100: '#FBE0CC',
          200: '#F2C0A2',
          300: '#E0A080',
          400: '#CC7652',
          500: '#B5533C',  // brick 4.9:1 on white
          600: '#9A4532',  // brick-dark for text 6.4:1
          700: '#7D3728',
          800: '#5E2A1E',
          900: '#3F1C14',
        },
        // ── DANGER — red (distinct from brick) ──
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#DC2626',  // 4.6:1 on white
          600: '#B91C1C',
          700: '#991B1B',
          800: '#7F1D1D',
          900: '#450A0A',
        },
        // ── SUCCESS — forest-emerald (aligned but distinct from primary) ──
        success: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          300: '#6EE7B7',
          400: '#34D399',
          500: '#0E7C5A',  // 4.9:1 on white
          600: '#0A5E44',
          700: '#064E3B',
          800: '#065F46',
          900: '#064E3B',
        },
        // ── WARNING / BRASS — text-safe amber/burnished gold ──
        warning: {
          50: '#FFF8E6',   // cream
          100: '#FFEDCC',
          200: '#FDD99A',
          300: '#C9A86A',  // decorative brass — NOT for text (2.2:1)
          400: '#B6935A',
          500: '#8B6F47',  // text-safe brass 4.7:1 on white
          600: '#6B5436',  // 7.1:1
          700: '#4A3B26',
          800: '#2E2418',
          900: '#1A150F',
        },
        // ── SURFACE — warm stone / parchment (AA compliant) ──
        surface: {
          50: '#FDF8EF',  // parchment — page bg
          100: '#F5F1E8',  // sidebar / subtle
          200: '#E8E0D1',  // border default — 1.31 vs white, 1.24 vs parchment
          300: '#D6C8B8',  // strong border / scrollbar — 1.55 vs white
          400: '#5B6B7F',  // muted text — 5.4:1 on white, 5.1 on parchment (AA)
          500: '#475569',  // secondary text — 7.5:1
          600: '#334155',  // strong secondary — 10.3:1
          700: '#1E293B',  // heading — 15:1
          800: '#0F172A',  // ink alt
          900: '#0C1218',  // ink — 18:1 on parchment, use for body text
        },
        // ── NIGHT — dark mode (softer, less harsh than #080D12) ──
        night: {
          50: '#F1F5F9',  // text primary in dark
          100: '#E2E8F0',
          200: '#CBD5E1',
          300: '#94A3B8',
          400: '#8A9BA8',  // secondary on dark 6.1:1 on #121A21
          500: '#71808C',  // muted but still 4.3 on #121A21 — use 400 instead
          600: '#3A4A57',
          650: '#232F3B',
          700: '#1A242E',
          800: '#121A21',  // card in dark
          850: '#0F1419',  // sidebar
          900: '#0C1218',  // page bg
          950: '#090E13',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        // campus-native gradients: forest → forest-deep, no violet
        'gradient-mesh': 'linear-gradient(135deg, #1B4332 0%, #143129 100%)',
        'gradient-glass': 'linear-gradient(135deg, rgba(253,248,239,0.8) 0%, rgba(253,248,239,0.4) 100%)',
        'hero-gradient': 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 50%, #143129 100%)',
        'accent-gradient': 'linear-gradient(135deg, #B5533C 0%, #9A4532 100%)',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(27, 67, 50, 0.08)',
        'glass-lg': '0 8px 32px 0 rgba(27, 67, 50, 0.14)',
        'soft': '0 2px 15px -3px rgba(27, 67, 50, 0.08), 0 10px 20px -2px rgba(27, 67, 50, 0.04)',
        'soft-lg': '0 10px 40px -10px rgba(27, 67, 50, 0.10)',
        'glow': '0 0 40px rgba(45, 106, 79, 0.25)',
        'glow-accent': '0 0 40px rgba(181, 83, 60, 0.22)',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'float-delayed': 'float 6s ease-in-out 2s infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'fade-in': 'fadeIn 0.5s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(45, 106, 79, 0.15)' },
          '100%': { boxShadow: '0 0 40px rgba(45, 106, 79, 0.30)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}

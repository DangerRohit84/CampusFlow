/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary — Spotify Green #1ed760 / #1db954 — WCAG AA on white/black
        primary: {
          50: '#e8f8ee',
          100: '#c7eed0',
          200: '#9be0ac',
          300: '#6fd28a',
          400: '#3ac567',
          500: '#1ed760',
          600: '#1db954',
          700: '#169c46',
          800: '#107a38',
          900: '#0a5a2a',
          950: '#04311a',
        },
        // Accent — Green alias (kept in sync with primary)
        accent: {
          50: '#e8f8ee',
          100: '#c7eed0',
          200: '#9be0ac',
          300: '#6fd28a',
          400: '#3ac567',
          500: '#1ed760',
          600: '#1db954',
          700: '#169c46',
          800: '#107a38',
          900: '#0a5a2a',
          950: '#04311a',
        },
        // Rose / Red — Spotify danger #ff4b5c (dark) / #ef4444 (light)
        danger: {
          50: '#fff1f2',
          100: '#ffe4e6',
          200: '#fecdd3',
          300: '#fda4af',
          400: '#fb7185',
          500: '#ff4b5c',
          600: '#ef4444',
          700: '#dc2626',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },
        // Success — Spotify ok #1db954
        success: {
          50: '#e8f8ee',
          100: '#c7eed0',
          200: '#9be0ac',
          300: '#6fd28a',
          400: '#3ac567',
          500: '#1ed760',
          600: '#1db954',
          700: '#169c46',
          800: '#107a38',
          900: '#0a5a2a',
          950: '#04311a',
        },
        // Warning — Spotify warn #f5b700 (dark) / #d97706 (light)
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f5b700',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        // Neutral — Spotify Light surfaces #ffffff / #f6f6f6 / #e5e7eb
        surface: {
          50: '#ffffff',
          100: '#f6f6f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#121212',
        },
        // Slate — Text #121212 (light bigT) · mut #62666d · fade #8a8f98
        slate: {
          50: '#f8fafc',
          100: '#f6f6f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#62666d',
          600: '#4b5563',
          700: '#374151',
          800: '#121212',
          900: '#000000',
        },
        // Night — Spotify Dark #000 / #121212 / #181818 / #282828
        night: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          650: '#27272a',
          700: '#1f1f1f',
          800: '#181818',
          850: '#121212',
          900: '#121212',
          950: '#000000',
        },
        // Brass / Gold — mapped to Spotify green (legacy compat, no blue clash)
        brass: {
          50: '#e8f8ee',100: '#c7eed0',200: '#9be0ac',300: '#6fd28a',400: '#3ac567',
          500: '#1ed760',600: '#1db954',700: '#169c46',800: '#107a38',900: '#0a5a2a',
        },
        gold: {
          50: '#e8f8ee',100: '#c7eed0',200: '#9be0ac',300: '#6fd28a',400: '#3ac567',
          500: '#1ed760',600: '#1db954',700: '#169c46',800: '#107a38',900: '#0a5a2a',
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
        'e1': '0 1px 3px 0 rgba(18, 18, 18, 0.06), 0 1px 2px -1px rgba(18, 18, 18, 0.04)',
        'e2': '0 4px 6px -1px rgba(18, 18, 18, 0.08), 0 2px 4px -2px rgba(18, 18, 18, 0.05)',
        'e3': '0 10px 15px -3px rgba(18, 18, 18, 0.10), 0 4px 6px -4px rgba(18, 18, 18, 0.05)',
        'soft': '0 1px 3px 0 rgba(18, 18, 18, 0.06), 0 1px 2px -1px rgba(18, 18, 18, 0.04)',
        'soft-lg': '0 4px 6px -1px rgba(18, 18, 18, 0.08), 0 2px 4px -2px rgba(18, 18, 18, 0.05)',
        'glass': '0 1px 3px 0 rgba(18, 18, 18, 0.06)',
        'glass-lg': '0 4px 6px -1px rgba(18, 18, 18, 0.08)',
        'glow': '0 0 15px rgba(30, 215, 96, 0.18)',
        'glow-accent': '0 0 15px rgba(30, 215, 96, 0.18)',
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

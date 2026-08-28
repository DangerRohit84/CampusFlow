/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html","./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Green — main brand color (buttons, links, active states)
        // Light tints are soft mint for backgrounds, dark shades for text and hovers
        primary: {
          50: '#EEF4F0',  // very light mint — card tint
          100: '#D6E9DE', // light mint — subtle background
          200: '#B6D2C3', // soft green border
          300: '#90B9A4', // muted green — icons, secondary
          400: '#5A8B75', // mid green
          500: '#2D6A4F', // main green — 6.4:1 on white, use for buttons
          600: '#1E4935', // dark green — hover, 11:1 on white
          700: '#163828',
          800: '#112921',
          900: '#0B1C16',
        },
        // Terracotta — secondary warm accent (highlights, second button, badges)
        // Warm orange-red, friendly and visible but not too strong
        accent: {
          50: '#FDF3EB',   // light peach — tint
          100: '#FBE9D8',
          200: '#F4C8A8',
          300: '#E5A582',
          400: '#D07E56',
          500: '#B5533C',  // main terracotta — 4.9:1 on white
          600: '#9A4532',  // darker for text — 6.4:1
          700: '#7D3728',
          800: '#5E2A1E',
          900: '#3F1C14',
        },
        // Red — errors, urgent, delete actions
        danger: {
          50: '#FEF2F2',100: '#FEE2E2',200: '#FECACA',300: '#FCA5A5',400: '#F87171',
          500: '#DC2626',600: '#B91C1C',700: '#991B1B',800: '#7F1D1D',900: '#450A0A',
        },
        // Emerald — success, done, safe states (slightly brighter than primary for clarity)
        success: {
          50: '#ECFDF5',100: '#D1FAE5',200: '#A7F3D0',300: '#6EE7B7',400: '#34D399',
          500: '#0F7F5B',600: '#0B5E44',700: '#064E3B',800: '#065F46',900: '#064E3B',
        },
        // Gold — warnings and highlight color (decorative gold, warm and visible)
        // 300 and lighter are only for decoration — not for text (low contrast ~1.4-1.9)
        // 500 and darker are safe for text — 4.71:1 on white AA PASS
        // Mapping: warning is semantic (white text) — needs darker 500 #8B6F47 for AA white-on-gold;
        //          brass/gold is decorative (black text on gold) — lighter 400 #D1B48C gives 9.5:1 black-on-gold;
        //          values intentionally offset by 1 tier — do not unify blindly. Use warning-500 for white-on-gold,
        //          brass-400/gold-400 for black-on-gold or borders. See palette-contrast.test.js for ratios.
        warning: {
          50: '#FFFBEB',   // cream
          100: '#FEF3C7',  // light gold
          200: '#FDE68A',  // soft gold
          300: '#D1B48C',  // decorative gold — 1.98:1 not for text (maps to brass-400/gold-400)
          400: '#BD9D69',  // 2.56:1 not for text
          500: '#8B6F47',  // text-safe gold — 4.71:1 on white, white on gold also 4.71 AA PASS
          600: '#6E5A3A',  // 6.59:1 on white
          700: '#4D3F27',
          800: '#312A1A',
          900: '#1E1910',
        },
        // Light neutral — page background, borders, and text
        // Clean off-white for eye comfort, not too yellow
        surface: {
          50: '#FEFCF7',  // page background — warm white, easy on eyes
          100: '#F6F1E5', // sidebar, subtle card
          200: '#EAE2CF', // border — visible but soft
          300: '#DBCCB8', // stronger border, scrollbar
          400: '#5F6B7D', // muted text — 5.5:1 on white, 5.2 on #FEFCF7
          500: '#475569', // secondary text — 7.5:1
          600: '#334155', // strong text — 10:1
          700: '#1E293B', // headings — 15:1
          800: '#0F172A',
          900: '#0C1218', // main text — near black, high contrast
        },
        // Dark — dark mode backgrounds and text (soft dark, not pure black)
        // Page is dark gray-blue for comfort, cards slightly lighter
        night: {
          50: '#F1F5F9',  // main text in dark
          100: '#E2E8F0',
          200: '#CBD5E1', // secondary text in dark
          300: '#98A7B8', // muted
          400: '#90A1AD', // muted text — 6.3:1 on #16202C
          500: '#7F8D9A',
          600: '#3D4E5C',
          650: '#273642', // border
          700: '#1E2E3B', // subtle surface
          800: '#16202C', // card
          850: '#131D28', // sidebar
          900: '#0F1821', // page alt
          950: '#0B1216', // page background — softer than pure black
        },
        // Gold — decorative accent (lighter gold for black text / borders, kept for existing code)
        // Use "gold" in new code — normal English word, easier to remember
        // Note: brass/gold 400 #D1B48C is decorative (9.5:1 black-on-gold); for white-on-gold use warning-500 #8B6F47
        // brass/gold scale is 1 tier lighter than warning by design — intentional, not a copy error
        brass: {
          50: '#FFFBEB',100: '#FEF3C7',200: '#FDE68A',300: '#FCD34D',400: '#D1B48C',
          500: '#BD9D69',600: '#8F7350',700: '#6E5A3A',
        },
        // Gold — same as brass, plain English name (prefer this in new code)
        // Identical to brass — decorative lighter gold; warning-500 is darker for white-text AA
        gold: {
          50: '#FFFBEB',100: '#FEF3C7',200: '#FDE68A',300: '#FCD34D',400: '#D1B48C',
          500: '#BD9D69',600: '#8F7350',700: '#6E5A3A',
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
        '11': '44px', // touch target
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
        // 3 elevations only - flat design, no glass or glow
        'e1': '0 1px 2px rgba(27,67,50,0.06), 0 1px 3px rgba(27,67,50,0.04)',
        'e2': '0 2px 8px rgba(27,67,50,0.08), 0 4px 12px rgba(27,67,50,0.06)',
        'e3': '0 8px 24px rgba(27,67,50,0.12), 0 4px 8px rgba(27,67,50,0.08)',
        // legacy aliases (kept so old code still works)
        'soft': '0 1px 2px rgba(27,67,50,0.06), 0 1px 3px rgba(27,67,50,0.04)',
        'soft-lg': '0 2px 8px rgba(27,67,50,0.08), 0 4px 12px rgba(27,67,50,0.06)',
        'glass': '0 1px 2px rgba(27,67,50,0.06)',
        'glass-lg': '0 2px 8px rgba(27,67,50,0.08)',
        'glow': '0 0 0 rgba(0,0,0,0)',
        'glow-accent': '0 0 0 rgba(0,0,0,0)',
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

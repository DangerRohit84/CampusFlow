import React from 'react';
import { useTheme } from '../context/ThemeContext';
import './ThemeToggle.css';

function ThemeToggle() {
  const { dark, toggle } = useTheme();

  return (
    <div className="theme-lamp" onClick={toggle} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <svg className="theme-lamp__cord" viewBox="0 0 4 60" fill="none">
        <path d="M2 0v60" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      <div className="theme-lamp__bulb">
        <svg viewBox="0 0 32 48" fill="none" className="theme-lamp__icon" style={{ transform: 'scaleY(-1)' }}>
          {dark ? (
            <>
              <path d="M16 4C8.82 4 3 9.82 3 17c0 4.5 2.22 8.5 5.62 11 .8.6 1.38 1.5 1.38 2.5V32a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5c0-1 .58-1.9 1.38-2.5A13.94 13.94 0 0 0 29 17C29 9.82 23.18 4 16 4Z" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5" />
              <line x1="12" y1="36" x2="20" y2="36" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="13" y1="39" x2="19" y2="39" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14" y1="42" x2="18" y2="42" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="17" r="6" fill="#fef3c7" opacity="0.6" />
              <circle cx="16" cy="17" r="8" fill="#fef3c7" opacity="0.3" />
              <circle cx="16" cy="17" r="10" fill="#fef3c7" opacity="0.15" />
            </>
          ) : (
            <>
              <path d="M16 4C8.82 4 3 9.82 3 17c0 4.5 2.22 8.5 5.62 11 .8.6 1.38 1.5 1.38 2.5V32a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1.5c0-1 .58-1.9 1.38-2.5A13.94 13.94 0 0 0 29 17C29 9.82 23.18 4 16 4Z" fill="#334155" stroke="#475569" strokeWidth="1.5" />
              <line x1="12" y1="36" x2="20" y2="36" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="13" y1="39" x2="19" y2="39" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14" y1="42" x2="18" y2="42" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="16" cy="17" r="4" fill="#64748b" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

export default ThemeToggle;

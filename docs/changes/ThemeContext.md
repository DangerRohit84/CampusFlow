# ThemeContext.tsx

## Overview
React context for dark/light mode state management. Persists to localStorage.

## Changes

### 2026-08-13 — Initial Build
- Created with ThemeProvider
- Dark mode state persisted to localStorage
- Toggles `dark` class on `<html>` element

### 2026-08-18 — Flash Fix
- Changed `useEffect` → `useLayoutEffect` for instant theme apply
- Prevents flash of light mode on page refresh

## Dependencies
- `apps/web/index.html` — Inline dark mode script (prevents FOUC)

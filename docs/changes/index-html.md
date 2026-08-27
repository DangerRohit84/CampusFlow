# index.html

## Overview
Vite entry HTML file with inline dark mode script.

## Changes

### 2026-08-06 — Initial Build
- Created with Vite script tag

### 2026-08-18 — Dark Mode Flash Fix
- Added inline `<script>` in `<head>` to check localStorage for dark mode
- Adds `dark` class to `<html>` before React renders
- Prevents flash of light mode on page refresh

## Dependencies
- `src/context/ThemeContext.tsx` — Theme context

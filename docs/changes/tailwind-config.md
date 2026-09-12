# tailwind.config.js

## Overview
Tailwind CSS configuration with custom color theme and dark mode support.

## Changes

### 2026-08-06 — Initial Build
- Created with basic theme colors

### 2026-08-13 — Color Theme
- Updated with exact hex color palette
- `darkMode: 'class'` enabled
- Custom colors:
  - `surface-50` through `surface-900`
  - `primary-50` through `primary-900`
  - `danger-50` through `danger-900`
  - `warning-50` through `warning-900`
  - `accent-50` through `accent-900`

### 2026-08-18 — Important Removal
- Removed `important: true` from config
- Was causing specificity issues with dark mode overrides

## Dependencies
- None (root config)

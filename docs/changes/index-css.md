# index.css

## Overview
Global styles and dark mode overrides for Tailwind CSS.

## Changes

### 2026-08-06 — Initial Build
- Created with base Tailwind directives
- Added custom utility classes

### 2026-08-13 — Dark Mode Overrides
- Added comprehensive dark mode overrides
- Removed `[class*="bg-surface-800"]` selector (circular dependency)
- Updated with exact palette values:
  - `--surface-50`: `#FFFFFF` / `#111920`
  - `--surface-100`: `#FEF9F1` / `#0C1218`
  - `--surface-200`: `#F5F0E8` / `#151F27`
  - `--surface-500`: `#AAB0B8` / `#5E6D77`
  - `--surface-600`: `#79859A` / `#71808C`
  - `--surface-800`: `#3D4F5F` / `#111920`
  - `--surface-900`: `#1A1F36` / `#F4F7F8`
  - `--primary-600`: `#007060` / `#00A88F`
  - `--danger-600`: `#F07068` / `#FF5C57`
  - `--warning-600`: `#F5A623` / `#F5A623`

### 2026-08-18 — Text Overrides
- Added dark mode text overrides for all surface text colors
- Prevents hardcoded `text-gray-XXX` from showing white on dark backgrounds

## Dependencies
- `apps/web/tailwind.config.js` — Theme configuration

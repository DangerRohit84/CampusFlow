# parseJson.ts

## Overview
Utility for safely parsing JSON strings (for fields stored as JSON strings in DB).

## Changes

### 2026-08-18 — Initial Build
- Created `parseJsonArray(str)` — parses JSON string to array
- Returns empty array on parse failure
- Used by AdminOpportunitiesPage for `targetDepartments`, `schedule`, `tags`

## Dependencies
- None (utility module)

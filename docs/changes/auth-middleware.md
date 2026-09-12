# auth.ts (Backend Middleware)

## Overview
Authentication and authorization middleware for Express routes.

## Changes

### 2026-08-13 — Initial Build
- Created `authenticate` middleware — verifies JWT token, attaches user to request
- Created `authorize(roles)` middleware — checks user role against allowed roles
- Used by admin and departments routes

## Dependencies
- Prisma client — User lookup
- jsonwebtoken — JWT verification

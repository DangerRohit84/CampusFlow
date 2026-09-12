// lib/searchRoute.test.ts — locks topbottom F4 result routing.
import { describe, it, expect } from 'vitest'
import { getSearchResultRoute } from './searchRoute'

describe('getSearchResultRoute', () => {
  it('maps detail types to id routes', () => {
    expect(getSearchResultRoute({ type: 'assignmentHub', id: 'h1' })).toBe('/assignments/h1')
    expect(getSearchResultRoute({ type: 'hackathon', id: 'x' })).toBe('/hackathons/x')
    expect(getSearchResultRoute({ type: 'internship', id: 'y' })).toBe('/internships/y')
    expect(getSearchResultRoute({ type: 'form', id: 'f' })).toBe('/forms/f')
    expect(getSearchResultRoute({ type: 'room', id: 'r' })).toBe('/rooms/r')
  })
  it('maps list types to list routes', () => {
    expect(getSearchResultRoute({ type: 'schedule', id: 's' })).toBe('/schedule')
    expect(getSearchResultRoute({ type: 'assignment', id: 'a' })).toBe('/assignments')
    expect(getSearchResultRoute({ type: 'notification', id: 'n' })).toBe('/notifications')
    expect(getSearchResultRoute({ type: 'contest', id: 'c' })).toBe('/contests')
    expect(getSearchResultRoute({ type: 'task', id: 't' })).toBe('/tasks')
  })
  it('returns null for unknown/missing (non-clickable)', () => {
    expect(getSearchResultRoute({ type: 'nope', id: '1' })).toBeNull()
    expect(getSearchResultRoute({ type: 'room', id: '' })).toBeNull()
    expect(getSearchResultRoute(null)).toBeNull()
    expect(getSearchResultRoute(undefined)).toBeNull()
  })
})

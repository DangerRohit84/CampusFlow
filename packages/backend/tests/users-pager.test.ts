/**
 * TDD RED: users pager contract (AdminPage Users tab 50-cap follow-up).
 * Locks the dual-mode cursor/page pattern already used by
 * GET /admin/users, /admin/hackathons, /admin/forms, /notifications:
 * - no ?page/?limit/?cursor → capped array (compat), X-Total-Count header
 * - ?page/?limit/?cursor → envelope {data, pagination:{page,limit,total,pages,nextCursor}}
 * - limit clamps to 1..50, page floors to >=1, skip = (page-1)*limit
 * Pure helpers — hermetic Small tests (<100ms, no I/O).
 */
import { describe, it, expect } from 'vitest'
import {
  USERS_PAGE_SIZE,
  parseListPagination,
  buildPagedEnvelope,
  unwrapListResponse,
} from '../src/utils/pagination'

describe('USERS_PAGE_SIZE', () => {
  it('usersPageSize_is_50 (matches backend take:50 cap)', () => {
    expect(USERS_PAGE_SIZE).toBe(50)
  })
})

describe('parseListPagination', () => {
  it('parseListPagination_noQuery_returns_compatDefaults (wantsPaged false)', () => {
    expect(parseListPagination({})).toEqual({
      wantsPaged: false,
      limit: 50,
      page: 1,
      skip: 0,
      cursorId: null,
    })
  })
  it('parseListPagination_page2_defaults_limit50_skip50', () => {
    const p = parseListPagination({ page: '2' })
    expect(p.wantsPaged).toBe(true)
    expect(p.page).toBe(2)
    expect(p.limit).toBe(50)
    expect(p.skip).toBe(50)
  })
  it('parseListPagination_limit10_page3_skip20', () => {
    const p = parseListPagination({ page: '3', limit: '10' })
    expect(p).toMatchObject({ wantsPaged: true, page: 3, limit: 10, skip: 20 })
  })
  it('parseListPagination_limitOver50_clampsTo50', () => {
    expect(parseListPagination({ limit: '200' }).limit).toBe(50)
    expect(parseListPagination({ limit: '51' }).limit).toBe(50)
  })
  it('parseListPagination_limitZero_clampsTo1 (Math.max floor)', () => {
    expect(parseListPagination({ limit: '0' }).limit).toBe(1)
  })
  it('parseListPagination_limitGarbage_defaultsTo50', () => {
    expect(parseListPagination({ limit: 'abc' }).limit).toBe(50)
  })
  it('parseListPagination_pageZeroOrGarbage_floorsTo1', () => {
    expect(parseListPagination({ page: '0' }).page).toBe(1)
    expect(parseListPagination({ page: '-3' }).page).toBe(1)
    expect(parseListPagination({ page: 'abc' }).page).toBe(1)
  })
  it('parseListPagination_cursor_sets_wantsPaged_and_cursorId', () => {
    const p = parseListPagination({ cursor: 'user-123' })
    expect(p.wantsPaged).toBe(true)
    expect(p.cursorId).toBe('user-123')
  })
})

describe('buildPagedEnvelope', () => {
  it('buildPagedEnvelope_fullPage_sets_nextCursor_to_lastId', () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const env = buildPagedEnvelope({ rows, total: 120, page: 1, limit: 2 })
    expect(env.data).toEqual(rows)
    expect(env.pagination).toMatchObject({ page: 1, limit: 2, total: 120, pages: 60 })
    expect(env.pagination.nextCursor).toBe('b')
  })
  it('buildPagedEnvelope_partialPage_nextCursor_null (last page)', () => {
    const rows = [{ id: 'a' }]
    const env = buildPagedEnvelope({ rows, total: 3, page: 2, limit: 2 })
    expect(env.pagination.pages).toBe(2)
    expect(env.pagination.nextCursor).toBeNull()
  })
  it('buildPagedEnvelope_empty_total0_pages0', () => {
    const env = buildPagedEnvelope({ rows: [], total: 0, page: 1, limit: 50 })
    expect(env.pagination.total).toBe(0)
    expect(env.pagination.pages).toBe(0)
    expect(env.pagination.nextCursor).toBeNull()
  })
})

describe('unwrapListResponse', () => {
  it('unwrapListResponse_envelope_returns_data_total_pages', () => {
    const raw = { data: [{ id: 'a' }], pagination: { page: 2, limit: 50, total: 120, pages: 3, nextCursor: 'a' } }
    expect(unwrapListResponse(raw)).toEqual({ data: [{ id: 'a' }], total: 120, pages: 3, page: 2, limit: 50 })
  })
  it('unwrapListResponse_array_returns_compat_singlePage (no total header)', () => {
    const raw = [{ id: 'a' }, { id: 'b' }]
    const out = unwrapListResponse(raw)
    expect(out.data).toEqual(raw)
    expect(out.total).toBe(2)
    expect(out.pages).toBe(1)
    expect(out.page).toBe(1)
  })
})

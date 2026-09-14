/**
 * Users tabs page-size 100 cap (2026-09-14 user wish).
 * Dropdown 10/25/50/100 default 50, backend cap 100 (was 50 generic).
 * Generic lists (hackathons/forms) stay capped at 50.
 */
import { describe, it, expect } from 'vitest'
import { parseListPagination, USERS_PAGE_LIMIT_MAX, PAGE_LIMIT_MAX } from '../src/utils/pagination'

describe('users page-size cap 100', () => {
  it('users_cap_is_100_generic_stays_50', () => {
    expect(USERS_PAGE_LIMIT_MAX).toBe(100)
    expect(PAGE_LIMIT_MAX).toBe(50)
  })
  it('parseListPagination_default_50_cap', () => {
    expect(parseListPagination({ limit: '200' }).limit).toBe(50)
  })
  it('parseListPagination_users_max100_allows_100', () => {
    expect(parseListPagination({ limit: '100' }, 100).limit).toBe(100)
    expect(parseListPagination({ limit: '25' }, 100).limit).toBe(25)
  })
  it('parseListPagination_users_max100_clamps_200_to_100', () => {
    expect(parseListPagination({ limit: '200' }, 100).limit).toBe(100)
    expect(parseListPagination({ limit: '101' }, 100).limit).toBe(100)
  })
})

// lib/notificationHelpers.test.ts — locks topbottom F2 rollback transforms.
import { describe, it, expect } from 'vitest'
import { applyMarkRead, applyMarkAllRead, applyDelete } from './notificationHelpers'

const list = [
  { id: 'a', isRead: false },
  { id: 'b', isRead: false },
  { id: 'c', isRead: true },
]

describe('notification optimistic helpers', () => {
  it('applyMarkRead flips one, keeps others', () => {
    const next = applyMarkRead(list, 'b')
    expect(next.find((n) => n.id === 'b')?.isRead).toBe(true)
    expect(next.find((n) => n.id === 'a')?.isRead).toBe(false)
    expect(list.find((n) => n.id === 'b')?.isRead).toBe(false) // no mutate
  })
  it('applyMarkAllRead flips all', () => {
    expect(applyMarkAllRead(list).every((n) => n.isRead)).toBe(true)
  })
  it('applyDelete removes one', () => {
    const next = applyDelete(list, 'a')
    expect(next.map((n) => n.id)).toEqual(['b', 'c'])
    expect(list).toHaveLength(3)
  })
})

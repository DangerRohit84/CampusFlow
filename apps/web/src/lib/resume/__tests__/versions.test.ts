import { describe, it, expect } from 'vitest'
import { saveVersion, listVersions, restoreVersion, deleteVersion, clearVersions, createMemoryStore, MAX_VERSIONS, stripHeavyAsset } from '../versions'
import { emptyResumeData } from '../../resumeStorage'

describe('resume versions (localStorage versioned snapshots)', () => {
  it('saves newest-first and restores an exact clone', () => {
    const store = createMemoryStore()
    const d = emptyResumeData()
    d.personalInfo.fullName = 'Ada'
    const v1 = saveVersion('u1', d, 'first', store)
    d.personalInfo.fullName = 'Grace'
    saveVersion('u1', d, 'second', store)
    const list = listVersions('u1', store)
    expect(list).toHaveLength(2)
    expect(list[0].label).toBe('second')
    const restored = restoreVersion('u1', v1.id, store)!
    expect(restored.personalInfo.fullName).toBe('Ada')
    // clone: mutating restored must not affect stored version
    restored.personalInfo.fullName = 'Mutated'
    expect(restoreVersion('u1', v1.id, store)!.personalInfo.fullName).toBe('Ada')
  })

  it('prunes to MAX_VERSIONS', () => {
    const store = createMemoryStore()
    for (let i = 0; i < MAX_VERSIONS + 5; i++) {
      saveVersion('u1', { ...emptyResumeData(), updatedAt: String(i) }, `v${i}`, store)
    }
    expect(listVersions('u1', store)).toHaveLength(MAX_VERSIONS)
    expect(listVersions('u1', store)[0].label).toBe(`v${MAX_VERSIONS + 4}`)
  })

  it('deletes and clears per-user (isolation across users)', () => {
    const store = createMemoryStore()
    const v = saveVersion('alice', emptyResumeData(), 'a', store)
    saveVersion('bob', emptyResumeData(), 'b', store)
    deleteVersion('alice', v.id, store)
    expect(listVersions('alice', store)).toHaveLength(0)
    expect(listVersions('bob', store)).toHaveLength(1)
    clearVersions('bob', store)
    expect(listVersions('bob', store)).toHaveLength(0)
  })

  it('returns null for unknown version id, [] on corrupt JSON', () => {
    const store = createMemoryStore()
    expect(restoreVersion('u1', 'missing', store)).toBeNull()
    store.setItem('campusflow:resume:versions:u1', 'not-json{{{')
    expect(listVersions('u1', store)).toEqual([])
  })

  it('strips heavy originalAsset dataUrl so snapshots stay quota-safe', () => {
    const d = emptyResumeData()
    ;(d as any).originalAsset = { fileName: 'r.pdf', mimeType: 'application/pdf', size: 1, dataUrl: 'x'.repeat(600_000), uploadedAt: new Date().toISOString() }
    const stripped = stripHeavyAsset(d)
    expect(stripped.originalAsset!.dataUrl).toBe('')
    expect(stripped.originalAsset!.storedInDB).toBe(true)
  })
})

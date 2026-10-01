// components/ui/Modal.centering.test.ts — locks modal content-area centering.
// WHY: Modal used `fixed inset-0 flex center` (viewport center). With the
// persistent desktop sidebar (Layout.tsx: w-[280px] expanded / w-[72px]
// collapsed, lg+ only) viewport-center ≠ content-area center. Expanded
// center is viewport-center +140px, collapsed +36px — a 104px jump that
// made the popup look stuck when the sidebar opened.
// FIX: outer flex container keeps `fixed inset-0` (backdrop still covers
// the sidebar) but adds lg-only padding-left = sidebarWidth + 16px gutter
// (p-4), so flex centering lands on the content-area center. Mobile
// (<lg, sidebar is an overlay drawer) keeps plain `inset-0` centering.
// Shared helper lives in ./modalCentering so all 23 centered overlays reuse
// one source of truth; Modal.tsx re-exports for backward compat.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getModalCenteringClass as getShared, MODAL_CENTERING_TRANSITION } from './modalCentering'
import { getModalCenteringClass as getLegacy } from './Modal'

describe('getModalCenteringClass', () => {
  it('expanded sidebar offsets by 280px + 16px gutter', () => {
    expect(getShared(true)).toBe('lg:pl-[296px]')
  })

  it('collapsed sidebar offsets by 72px + 16px gutter', () => {
    expect(getShared(false)).toBe('lg:pl-[88px]')
  })

  it('both classes are lg-only so mobile overlay stays viewport-centered', () => {
    expect(getShared(true).startsWith('lg:')).toBe(true)
    expect(getShared(false).startsWith('lg:')).toBe(true)
  })

  it('Modal re-export stays in sync with shared helper (backward compat)', () => {
    expect(getLegacy(true)).toBe(getShared(true))
    expect(getLegacy(false)).toBe(getShared(false))
  })

  it('transition token stays lg-only (no mobile layout shift)', () => {
    expect(MODAL_CENTERING_TRANSITION).toContain('lg:transition-[padding-left]')
    expect(MODAL_CENTERING_TRANSITION).toContain('lg:duration-200')
  })
})

describe('centered overlays use shared helper (no drift)', () => {
  // WHY: 23 files / 37 overlays duplicated `fixed inset-0 flex center`
  // without the sidebar offset — each drifted independently. Guard locks
  // every centered overlay to the shared helper so future modals cannot
  // reintroduce viewport-centering. Excludes intentional non-centered
  // surfaces: Layout drawer/backdrop, AvatarDropdown, Resume export menu,
  // RoomChatPanel menus, CookieConsent, CenteredLoader.
  const centeredFiles = [
    'ConfirmModal.tsx',
    '../ReportModal.tsx',
    '../alumni/RequestMentorModal.tsx',
    '../CommandPalette.tsx',
    '../UsernameSetupModal.tsx',
    '../admin/BulkImportModal.tsx',
    '../admin/BulkDeleteModal.tsx',
    '../admin/BulkPasswordModal.tsx',
    '../shared/AssignPopup.tsx',
    '../shared/EligibilityPopup.tsx',
    '../../pages/InternshipsPage.tsx',
    '../../pages/InternshipDetailPage.tsx',
    '../../pages/HackathonsPage.tsx',
    '../../pages/HackathonDetailPage.tsx',
    '../../pages/CodingProfilePage.tsx',
    '../../pages/CodingContestsPage.tsx',
    '../../pages/GradesPage.tsx',
    '../../pages/AdminOpportunitiesPage.tsx',
    '../../pages/AttendancePage.tsx',
    '../../pages/FormsPage.tsx',
    '../../pages/ReportsPage.tsx',
    '../../pages/AdminPage.tsx',
    '../../pages/ResumeStudioPage.tsx',
  ]
  const thisDir = dirname(fileURLToPath(import.meta.url))

  for (const rel of centeredFiles) {
    it(`${rel} imports shared centering helper`, () => {
      const abs = join(thisDir, rel)
      expect(existsSync(abs), `${rel} should exist`).toBe(true)
      const src = readFileSync(abs, 'utf8')
      const usesHelper =
        src.includes('useModalCenteringClass') || src.includes('getModalCenteringClass')
      expect(usesHelper, `${rel} must import useModalCenteringClass/getModalCenteringClass`).toBe(true)
    })
  }
})

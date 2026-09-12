/**
 * Regression: change-handle-then-sync (Contest Profile / Coding Profile).
 *
 * Bug: first username add + Sync OK, change username + Save purges old
 * participations/stats, then immediate Sync Stats fails (throttle 429 hidden
 * as generic "Sync failed", empty profile).
 *
 * Root cause (codingProfile.ts): PUT deletes stale participations + filters
 * stats for changed platforms but leaves the 5-min per-user `syncThrottle`
 * entry from the first sync. POST /sync then returns 429, frontend swallows
 * it in a bare `catch { toast.error('Sync failed') }`, and handleSave never
 * calls notifyEntityMutated('coding-profile') so RQ/socket fan-out stays stale.
 *
 * Hermetic: static source assertions (no DB/network), same style as
 * state-sync.test.ts. Fails before fix, passes after.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const BACKEND_SRC = path.resolve(__dirname, '../src');
const WEB_SRC = path.resolve(__dirname, '../../../apps/web/src');

function readBackend(rel: string): string {
  return fs.readFileSync(path.join(BACKEND_SRC, rel), 'utf8');
}
function readWeb(rel: string): string {
  return fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
}

describe('contest sync after handle change (change-handle-then-sync)', () => {
  it('PUT clears per-user sync throttle when handles change (immediate re-sync allowed)', () => {
    const src = readBackend('routes/codingProfile.ts');
    // PUT handler must reset the 5-min throttle so the user can sync the NEW
    // handle immediately. First-add (no prior throttle / no changed handles)
    // is unaffected because delete on missing key is a no-op.
    expect(
      src,
      'PUT /coding-profile must call syncThrottle.delete(req.userId) when handles change, else second sync within 5min returns 429'
    ).toMatch(/syncThrottle\.delete\s*\(\s*req\.userId/);
  });

  it('Sync failure surfaces backend message (no silent generic)', () => {
    const src = readWeb('pages/CodingProfilePage.tsx');
    // handleSync catch must forward backend error (429 throttled / 500 Failed
    // to sync) instead of bare toast.error('Sync failed').
    const handleSyncIdx = src.indexOf('const handleSync');
    expect(handleSyncIdx, 'handleSync missing').toBeGreaterThan(-1);
    const slice = src.slice(handleSyncIdx, handleSyncIdx + 3500);
    expect(
      slice,
      "handleSync catch must surface e.response?.data?.error (else 429 'Sync already started recently' is hidden as generic 'Sync failed')"
    ).toMatch(/response\?\.data\?\.error/);
  });

  it('Handle save invalidates coding-profile entity (RQ + socket fan-out)', () => {
    const src = readWeb('pages/CodingProfilePage.tsx');
    // notifyEntityMutated is already imported but never called on save;
    // without it RQ ['coding-profile']/['contests']/dashboard stay stale.
    const saveIdx = src.indexOf('const handleSave');
    expect(saveIdx, 'handleSave missing').toBeGreaterThan(-1);
    const slice = src.slice(saveIdx, saveIdx + 2000);
    expect(
      slice,
      "handleSave must call notifyEntityMutated('coding-profile') after update"
    ).toContain("notifyEntityMutated('coding-profile'");
  });

  it('Sync throttle window is 1 minute (60s)', () => {
    const src = readBackend('routes/codingProfile.ts');
    // Task: sync throttle 5-min -> 1-min so users retry quickly.
    // WHY: 5-min window hid behind generic error; 60s + visible countdown
    // keeps first-add + change-handle flows intact while unblocking retry.
    expect(
      src,
      'SYNC_THROTTLE_MS must be 1 minute (60 * 1000), not 5 minutes'
    ).toMatch(/SYNC_THROTTLE_MS\s*=\s*60\s*\*\s*1000|SYNC_THROTTLE_MS\s*=\s*60000/);
    expect(
      src,
      'old 5-minute throttle must be gone'
    ).not.toMatch(/5\s*\*\s*60\s*\*\s*1000/);
  });

  it('429 throttle response returns remaining seconds (retryAfterSec)', () => {
    const src = readBackend('routes/codingProfile.ts');
    // WHY: UI needs remaining seconds to render a live "Sync in Ns"
    // countdown instead of a generic failure toast.
    expect(
      src,
      '429 response must include retryAfterSec so UI can count down'
    ).toMatch(/retryAfterSec/);
    expect(
      src,
      '429 must still use status 429'
    ).toMatch(/status\(429\)/);
  });

  it('Sync button shows live 1s countdown and stays disabled during cooldown', () => {
    const src = readWeb('pages/CodingProfilePage.tsx');
    // WHY: throttle without visible timer looks like a broken Sync button;
    // countdown re-enables at 0 and mutation-pending also disables.
    expect(src, 'button must render live "Sync in Ns" countdown').toMatch(/Sync in/);
    expect(src, 'countdown must tick every 1s').toMatch(/setInterval[\s\S]{0,800}1000/);
    expect(src, 'countdown must be announced (aria-live)').toMatch(/aria-live/);
    expect(
      src,
      'sync button must expose disabled state to AT (aria-disabled or disabled)'
    ).toMatch(/aria-disabled|disabled/);
    expect(
      src,
      'frontend must consume backend retryAfterSec for the countdown seed'
    ).toMatch(/retryAfterSec/);
  });
});

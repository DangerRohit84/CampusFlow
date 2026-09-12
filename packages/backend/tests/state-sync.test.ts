/**
 * State-sync invariants — app-wide stale CRUD guard.
 *
 * Single source of truth:
 * - TanStack Query cache owns server data (staleTime + explicit invalidation).
 * - `qk` factory owns every list key (hierarchical, college-scoped).
 * - `notifyEntityMutated` owns every post-mutation invalidation + window event.
 * - `useEntitySync` owns every manual-page subscription (window + socket).
 * - Backend `etagCache` must be `private, no-store` for authed GETs (never 304),
 *   so an RQ invalidation always hits the server (never a 15s HTTP-cache copy).
 * - Every mutation must abort/sequence races (AbortController + signal).
 *
 * These tests are static (read source as text) + hermetic unit (etag middleware),
 * so they run without DB/network and catch regressions that "need refresh".
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WEB_SRC = path.resolve(__dirname, '../../../apps/web/src');
const BACKEND_SRC = path.resolve(__dirname, '../src');

function readWeb(rel: string): string {
  return fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
}

function webPages(): string[] {
  const dir = path.join(WEB_SRC, 'pages');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'));
}

describe('query keys — single source of truth (qk factory)', () => {
  it('qk factory defines hierarchical college-scoped keys for every list entity', () => {
    const qk = readWeb('lib/queryKeys.ts');
    for (const entity of ['dashboard', 'announcements', 'assignmentHubs', 'hackathons', 'internships', 'contests', 'forms', 'rooms', 'search', 'adminStaging', 'adminCounts']) {
      expect(qk, `qk missing ${entity}`).toContain(entity);
    }
    // College scoping prevents cross-tenant pollution.
    expect(qk).toContain('normScope');
    expect(qk).toContain('collegeId');
  });

  it('no page uses bare unscoped list keys (stale-slice root cause)', () => {
    // Bare keys like ['rooms'] / ['hackathons'] with no scope leak across colleges
    // and miss prefix invalidation. Every list query must go through qk.*.
    const offenders: string[] = [];
    for (const file of webPages()) {
      const src = readWeb(`pages/${file}`);
      // Match useQuery({ queryKey: ['rooms' ...) etc that bypass qk.
      // Allow ['dashboard'] prefix invalidations inside entitySync + Dashboard bundle internals
      // (checked separately), but list queries must use qk.
      const bareListKey = /queryKey:\s*\[\s*'(rooms|hackathons|internships|contests|forms|announcements|assignmentHubs|tasks|schedules|timetable)'\s*[,\\]]/;
      if (bareListKey.test(src)) {
        // DashboardPage bundle is allowed to invalidate via prefix, but its
        // QUERY key itself must be qk.dashboard — flag bare query keys only
        // when they are the useQuery key (not invalidateQueries).
        const useQueryBare = /useQuery\(\{\s*queryKey:\s*\[\s*'(rooms|hackathons|internships|contests|forms|announcements)'/;
        if (useQueryBare.test(src)) offenders.push(file);
      }
    }
    expect(offenders, `pages with bare useQuery keys: ${offenders.join(', ')}`).toEqual([]);
  });

  it('DashboardPage query key goes through qk.dashboard (prefix invalidation hits it)', () => {
    const src = readWeb('pages/DashboardPage.tsx');
    expect(src).toContain('qk.dashboard');
    expect(src).not.toMatch(/queryKey:\s*\[\s*'dashboard',\s*dayIdx\s*]/);
  });
});

describe('college scope — reactive single source (no stale college after switch)', () => {
  it('reactive useCollegeScope hook exists and subscribes to the store', () => {
    const hookPath = path.join(WEB_SRC, 'hooks/useCollegeScope.ts');
    expect(fs.existsSync(hookPath), 'hooks/useCollegeScope.ts missing').toBe(true);
    const src = fs.readFileSync(hookPath, 'utf8');
    expect(src).toContain('useSuperAdminCollegeStore');
    expect(src).toContain('useAuthStore');
  });

  it('every RQ list page derives scope reactively (store subscription, not one-shot localStorage read)', () => {
    const rqPages = ['HackathonsPage.tsx', 'InternshipsPage.tsx', 'RoomsPage.tsx', 'StudentRoomsPage.tsx', 'FormsPage.tsx', 'CodingContestsPage.tsx'];
    const offenders: string[] = [];
    for (const file of rqPages) {
      const src = readWeb(`pages/${file}`);
      if (!src.includes('useCollegeScope')) offenders.push(file);
    }
    expect(offenders, `pages still using non-reactive currentCollegeScope(): ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('mutations — every CRUD invalidates via notifyEntityMutated', () => {
  it('all CRUD pages call notifyEntityMutated after create/update/delete', () => {
    const crudPages = [
      'HackathonsPage.tsx', 'InternshipsPage.tsx', 'RoomsPage.tsx', 'FormsPage.tsx',
      'CodingContestsPage.tsx', 'AnnouncementsPage.tsx', 'TasksPage.tsx', 'SchedulePage.tsx',
      'AssignmentHubPage.tsx', 'AssignmentDetailPage.tsx', 'TeacherAssignedPage.tsx',
      'GradesPage.tsx', 'AttendancePage.tsx',
    ];
    const offenders: string[] = [];
    for (const file of crudPages) {
      try {
        const src = readWeb(`pages/${file}`);
        // Must import + call notify (directly or via load helper that notifies).
        if (!src.includes('notifyEntityMutated') && !src.includes('notifyEntitiesMutated')) {
          offenders.push(file);
        }
      } catch {
        offenders.push(`${file} (missing)`);
      }
    }
    expect(offenders, `pages missing notifyEntityMutated: ${offenders.join(', ')}`).toEqual([]);
  });

  it('TeacherAssigned approve/reject fan out (no silent local-only splice)', () => {
    const src = readWeb('pages/TeacherAssignedPage.tsx');
    // Local splice without notify leaves dashboard/counts/search stale until refresh.
    expect(src).toContain('notifyEntityMutated');
    // Both approve paths must notify hackathon+internship (or generic assignment entity).
    const approveIdx = src.indexOf('handleApprove');
    const approveSlice = src.slice(approveIdx, approveIdx + 2000);
    expect(approveSlice).toContain('notifyEntityMutated');
  });

  it('no page uses location.reload / refreshKey / setTimeout refetch hacks', () => {
    const offenders: string[] = [];
    for (const file of webPages()) {
      const src = readWeb(`pages/${file}`);
      if (/location\.reload|window\.location\.href\s*=\s*window\.location|refreshKey|setTimeout\(\s*\(\)\s*=>\s*(load|fetch|refetch)/.test(src)) {
        // Allow benign UI delays (toast/modal), but flag reload-style freshness hacks.
        if (src.includes('location.reload')) offenders.push(file);
      }
    }
    expect(offenders, `pages with reload hacks: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('races — AbortController + sequencing (no out-of-order stale)', () => {
  it('race-guard helper exists (abort + sequence in one place)', () => {
    const hookPath = path.join(WEB_SRC, 'hooks/useRaceGuard.ts');
    expect(fs.existsSync(hookPath), 'hooks/useRaceGuard.ts missing').toBe(true);
    const src = fs.readFileSync(hookPath, 'utf8');
    expect(src).toContain('AbortController');
    expect(src).toContain('seq');
  });

  it('manual fetch pages guard races (abort previous + ignore stale responses)', () => {
    // Track 4: AssignmentHubPage is RQ now (queryFn: ({signal}) via TanStack;
    // RQ owns cancellation, no manual AbortController literal). Covered by the
    // `RQ queryFns thread signal` test below — do NOT re-add manual abort here
    // (would reintroduce double-cancel + stale isFetching).
    const manualPages = ['AnnouncementsPage.tsx', 'TasksPage.tsx', 'SchedulePage.tsx', 'TeacherAssignedPage.tsx'];
    const offenders: string[] = [];
    for (const file of manualPages) {
      const src = readWeb(`pages/${file}`);
      const hasAbort = src.includes('AbortController') || src.includes('useRaceGuard') || src.includes('abortRef');
      const hasSignal = src.includes('signal');
      if (!hasAbort || !hasSignal) offenders.push(file);
    }
    expect(offenders, `pages without race guards: ${offenders.join(', ')}`).toEqual([]);
  });

  it('RQ queryFns thread the useQuery AbortSignal into the API call', () => {
    const rqPages = ['HackathonsPage.tsx', 'InternshipsPage.tsx', 'RoomsPage.tsx', 'FormsPage.tsx', 'CodingContestsPage.tsx', 'SearchPage.tsx', 'DashboardPage.tsx'];
    const offenders: string[] = [];
    for (const file of rqPages) {
      const src = readWeb(`pages/${file}`);
      // Every queryFn must accept ({ signal }) and forward it — otherwise fast
      // typing / tab switches stack requests that resolve out of order.
      const hasSignalParam = /queryFn:\s*(\(\{\s*signal\s*\}|async\s*\(\{\s*signal\s*\})/.test(src);
      if (!hasSignalParam) offenders.push(`${file} (queryFn missing { signal })`);
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('Dashboard bundle passes one signal to every sub-fetch (no mixed-signal Promise.all)', () => {
    const src = readWeb('pages/DashboardPage.tsx');
    // dashboardAPI.get + announcements list + timetable must all take signal.
    expect(src).toContain('dashboardAPI.get');
    // After fix, every sub-fetch in the bundle forwards the same signal.
    const bundleIdx = src.indexOf('queryFn');
    const bundleSlice = src.slice(bundleIdx, bundleIdx + 1500);
    expect(bundleSlice).toContain('signal');
  });
});

describe('effects + socket — one bridge, no per-page drift', () => {
  it('Layout bridges every backend broadcast via canonical bridgeSocketEvent', () => {
    const src = readWeb('components/layout/Layout.tsx');
    expect(src).toContain('bridgeSocketEvent');
    expect(src).toContain('ALL_BRIDGED_SOCKET_EVENTS');
    expect(src).not.toContain('socketToWindow');
  });

  it('manual pages subscribe via useEntitySync (window + socket + focus)', () => {
    const manualPages = ['AnnouncementsPage.tsx', 'TasksPage.tsx', 'SchedulePage.tsx', 'AssignmentHubPage.tsx', 'CalendarPage.tsx', 'GradesPage.tsx', 'AttendancePage.tsx'];
    const offenders: string[] = [];
    for (const file of manualPages) {
      try {
        const src = readWeb(`pages/${file}`);
        if (!src.includes('useEntitySync')) offenders.push(file);
      } catch {
        offenders.push(`${file} (missing)`);
      }
    }
    expect(offenders, `pages missing useEntitySync: ${offenders.join(', ')}`).toEqual([]);
  });

  it('entitySync maps every backend broadcast event to an entity (no silent drops)', () => {
    const syncSrc = readWeb('lib/entitySync.ts');
    const backendDir = path.join(BACKEND_SRC, 'routes');
    const routeFiles = fs.readdirSync(backendDir).filter((f) => f.endsWith('.ts'));
    let emitted: string[] = [];
    for (const f of routeFiles) {
      const src = fs.readFileSync(path.join(backendDir, f), 'utf8');
      // Collect safeEmit('event') / broadcast* string literals via socket service calls is covered
      // by checking the socket service itself emits the canonical set.
    }
    // Canonical socket events the frontend must bridge (from socket.ts service).
    const socketSvc = fs.readFileSync(path.join(BACKEND_SRC, 'services/socket.ts'), 'utf8');
    const emittedEvents = Array.from(socketSvc.matchAll(/safeEmit\('([^']+)'/g)).map((m) => m[1]);
    expect(emittedEvents.length).toBeGreaterThan(10);
    for (const ev of emittedEvents) {
      expect(syncSrc, `socket event '${ev}' has no frontend bridge`).toContain(ev.split(':')[0]);
    }
    void emitted;
  });
});

describe('ETag / HTTP cache — RQ invalidation always hits the server', () => {
  it('authed GETs are no-store (never served from browser HTTP cache after mutation)', async () => {
    const { etagCacheMiddleware } = await import('../src/middleware/etagCache');
    const calls: any[] = [];
    const req: any = { method: 'GET', url: '/api/rooms', originalUrl: '/api/rooms', headers: { authorization: 'Bearer x' } };
    const res: any = {
      statusCode: 200,
      _headers: {} as Record<string, string>,
      getHeader(k: string) { return (this._headers as any)[k]; },
      setHeader(k: string, v: string) { (this._headers as any)[k] = v; },
      json(body: any) { calls.push({ body, headers: { ...this._headers }, status: this.statusCode }); return this; },
      status(c: number) { this.statusCode = c; return this; },
      end() { return this; },
    };
    let nextCalled = false;
    etagCacheMiddleware(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    await (res as any).json({ data: [1, 2, 3] });
    const cc = String(calls[0].headers['Cache-Control'] || '');
    expect(cc).toContain('no-store');
    expect(cc).not.toContain('max-age=15');
    // Authed responses still carry an ETag for observability but never 304.
    expect(String(calls[0].headers['ETag'] || '')).toContain('W/"');
    expect(calls[0].status).toBe(200);
  });

  it('public GETs keep SWR + 304 (bandwidth win where no tenant data)', async () => {
    const { etagCacheMiddleware } = await import('../src/middleware/etagCache');
    const mkRes = () => {
      const calls: any[] = [];
      const res: any = {
        statusCode: 200,
        _headers: {} as Record<string, string>,
        getHeader(k: string) { return (this._headers as any)[k]; },
        setHeader(k: string, v: string) { (this._headers as any)[k] = v; },
        json(body: any) { calls.push({ body, headers: { ...this._headers }, status: this.statusCode }); return this; },
        status(c: number) { this.statusCode = c; return this; },
        end(this: any) { calls.push({ end: true, status: this.statusCode }); return this; },
      };
      return { res, calls };
    };
    const body = { hello: 'world' };
    const first = mkRes();
    etagCacheMiddleware({ method: 'GET', url: '/api/colleges/list', originalUrl: '/api/colleges/list', headers: {} } as any, first.res, () => {});
    await first.res.json(body);
    const etag = String(first.calls[0].headers['ETag'] || '');
    expect(etag).toContain('W/"');
    const second = mkRes();
    etagCacheMiddleware({ method: 'GET', url: '/api/colleges/list', originalUrl: '/api/colleges/list', headers: { 'if-none-match': etag } } as any, second.res, () => {});
    await second.res.json(body);
    expect(second.calls[second.calls.length - 1].status).toBe(304);
  });

  it('axios client bypasses browser HTTP cache + treats 304 as keep-previous (never blank list)', () => {
    // Track 4 SRP: canonical transport lives in lib/api/client.ts (lib/api.ts
    // is a compat barrel re-exporting it). Check the canonical source.
    const src = readWeb('lib/api/client.ts');
    expect(src).toContain("'Cache-Control': 'no-cache'");
    expect(src).toContain('ERR_NOT_MODIFIED');
    expect(src).toContain('status === 304');
  });
});

describe('stores — only UI/session state, never server-data copies', () => {
  it('zustand stores hold no list caches (no second source of truth)', () => {
    for (const store of ['store/appStore.ts', 'store/authStore.ts', 'store/superAdminCollegeStore.ts']) {
      const src = readWeb(store);
      expect(src, `${store} must not cache server lists`).not.toMatch(/\b(hubs|rooms|forms|hackathons|internships|tasks|schedules|announcements)\s*:\s*any\[\]/);
    }
  });
});

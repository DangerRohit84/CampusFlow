/**
 * Entity sync bus — single source of truth for cross-page freshness.
 *
 * ARCHITECTURE (fixes split-brain stale state):
 * - TanStack Query cache is the ONLY server-data store. No page keeps a
 *   private `useState` copy as truth; manual pages re-fetch via this bus.
 * - `notifyEntityMutated(entity)` is called after EVERY successful
 *   CREATE/UPDATE/DELETE. It (1) invalidates the entity prefix + all related
 *   keys (dashboard/counts/search), and (2) dispatches a window CustomEvent
 *   for same-tab manual pages + cross-tab listeners.
 * - `useEntitySync(entity | entities, refetch)` subscribes a manual page to
 *   BOTH window events (same-tab + cross-tab) AND socket events (cross-client).
 *   Backend already broadcasts `entity:mutated` over socket for every entity;
 *   Layout bridges ALL socket events → window events, so this hook covers
 *   same-tab, cross-tab, and cross-device updates with one call.
 * - AbortController + request sequencing lives in callers; this module never
 *   uses setTimeout/reload/refreshKey hacks.
 */
import { useEffect, useRef } from 'react'
import { queryClient } from './queryClient'
import { getSocket } from './socket'
import { logger } from './logger'

export type EntityKind =
  | 'announcement'
  | 'assignment'
  | 'task'
  | 'schedule'
  | 'hackathon'
  | 'internship'
  | 'contest'
  | 'coding-profile'
  | 'form'
  | 'room'
  | 'message'
  | 'attendance'
  | 'grade'
  | 'report'
  | 'notification'
  | 'college'
  | 'user'
  | 'department'

/** Canonical window event per entity. Always `<entity>:mutated`. */
export function entityWindowEvent(entity: EntityKind): string {
  return `${entity}:mutated`
}

/** Socket events the backend emits per entity (global broadcast). */
const SOCKET_EVENTS: Record<EntityKind, string[]> = {
  announcement: ['announcement:mutated', 'announcement:created', 'announcement:updated', 'announcement:deleted'],
  assignment: ['assignment:mutated', 'assignment:hub:updated', 'assignment:submission:updated', 'assignment:graded', 'assignment:offline:marked', 'assignment:bulk:graded', 'assignment:pending:updated', 'assignment:stats:updated'],
  task: ['task:mutated', 'schedule:mutated', 'calendar:mutated', 'timetable:mutated'],
  schedule: ['schedule:mutated', 'calendar:mutated', 'schedule:update', 'timetable:mutated', 'task:mutated'],
  hackathon: ['hackathon:mutated', 'hackathon:updated', 'hackathon:created', 'hackathon:deleted', 'hackathon:staging:updated'],
  internship: ['internship:mutated', 'internship:updated', 'internship:created', 'internship:deleted', 'internship:staging:updated'],
  contest: ['contest:mutated', 'contest:updated', 'contest:created', 'contest:deleted'],
  'coding-profile': ['coding:profile:mutated', 'contest:mutated'],
  form: ['form:mutated', 'form:updated', 'form:response:updated', 'form:extended'],
  // PERPAGE-HALF1: message events REMOVED from the room socket list. They
  // bridged to 'room' (prefix match below), so every chat message refetched
  // room DETAIL pages (useEntitySync(['room','message'], loadRoom) → getOne
  // per message). Messages now route to the 'message' entity only; detail
  // pages subscribe to ['room'] (metadata) while RoomChatPanel owns messages
  // via its own socket subscription. RQ lists are unaffected (staleTime
  // coalesces; RELATED 'message' still busts ['rooms'] when stale).
  room: ['room:mutated', 'room:updated', 'room:created', 'room:deleted'],
  message: ['room:message:new', 'room:message:deleted', 'room:message:edited', 'room:message:reaction'],
  attendance: ['attendance:mutated', 'attendance:updated'],
  grade: ['grade:mutated', 'grade:updated'],
  report: ['report:mutated'],
  notification: ['notification:new', 'announcement:mutated'],
  college: ['college:mutated', 'announcement:mutated', 'user:mutated'],
  user: ['user:mutated', 'college:mutated'],
  department: ['department:mutated'],
}

/** Related RQ prefixes to invalidate per entity (entity + dashboard/counts/search fan-out). */
const RELATED_PREFIXES: Record<EntityKind, string[][]> = {
  announcement: [['announcements'], ['dashboard'], ['notifications'], ['search']],
  assignment: [['assignmentHubs'], ['hubs'], ['assignments'], ['mySubmissions'], ['dashboard'], ['search'], ['tasks'], ['schedules'], ['timetable']],
  task: [['tasks'], ['dashboard'], ['schedules'], ['timetable'], ['search']],
  schedule: [['schedules'], ['timetable'], ['dashboard'], ['search']],
  hackathon: [['hackathons'], ['dashboard'], ['search'], ['admin-staging'], ['admin-counts'], ['admin']],
  internship: [['internships'], ['dashboard'], ['search'], ['admin-staging'], ['admin-counts'], ['admin']],
  contest: [['contests'], ['dashboard'], ['search'], ['coding-profile']],
  // PERPAGE-HALF1: ['leaderboard'] added — ContestLeaderboardPage now owns an
  // RQ query on qk.leaderboard(); profile syncs/mutations must bust it so the
  // board refreshes once fresh (staleTime 60s coalesces bursts).
  'coding-profile': [['coding-profile'], ['contests'], ['leaderboard'], ['dashboard'], ['search']],
  form: [['forms'], ['dashboard'], ['search'], ['admin-staging'], ['admin']],
  room: [['rooms'], ['dashboard'], ['search'], ['notifications']],
  message: [['rooms'], ['notifications']],
  attendance: [['attendance'], ['dashboard']],
  grade: [['grades'], ['dashboard']],
  report: [['super-dashboard'], ['dashboard']],
  notification: [['notifications'], ['dashboard']],
  // Admin SSOT (I-7): qk.admin.* hierarchy — prefix ['admin'] catches bundle,
  // ['admin-users']/['admin-role-counts'] catch users/tabs, ['admin-colleges']
  // catches picker. Never invalidate dead bare keys again.
  college: [['admin'], ['admin-users'], ['admin-role-counts'], ['admin-colleges'], ['super-dashboard'], ['announcements'], ['dashboard']],
  user: [['admin'], ['admin-users'], ['admin-role-counts'], ['admin-colleges'], ['super-dashboard'], ['dashboard'], ['search']],
  department: [['admin'], ['departments'], ['dashboard']],
}

function invalidatePrefixes(prefixes: string[][]) {
  for (const key of prefixes) {
    try {
      // Fire-and-forget: callers already show their own toast/loader.
      // Awaiting here would serialize unrelated refetches (p95 regression).
      void queryClient.invalidateQueries({ queryKey: key }).catch((err) => {
        logger.debug('[entitySync] invalidate failed (non-fatal)', { err, key })
      })
    } catch (err) {
      logger.debug('[entitySync] invalidate threw (non-fatal)', { err, key })
    }
  }
}

/**
 * Call after EVERY successful mutation. Invalidates RQ + notifies manual pages.
 * `detail` is forwarded as CustomEvent.detail (e.g. { hubId, formId, roomId }).
 */
export function notifyEntityMutated(entity: EntityKind, detail?: Record<string, unknown>) {
  invalidatePrefixes(RELATED_PREFIXES[entity] ?? [[entity]])
  // Always also bust dashboard bundle — it fans out 6 entities in one query.
  try {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] }).catch((err) => {
      logger.debug('[entitySync] dashboard invalidate failed (non-fatal)', { err })
    })
  } catch (err) {
    logger.debug('[entitySync] dashboard invalidate threw (non-fatal)', { err })
  }
  try {
    const ev = entityWindowEvent(entity)
    window.dispatchEvent(new CustomEvent(ev, { detail: detail ?? {} }))
  } catch (err) {
    logger.debug('[entitySync] window dispatch failed (non-fatal)', { err, entity })
  }
}

/** Notify several entities at once (e.g. task change also affects schedule). */
export function notifyEntitiesMutated(entities: EntityKind[], detail?: Record<string, unknown>) {
  const seen = new Set<string>()
  for (const e of entities) {
    for (const p of RELATED_PREFIXES[e] ?? [[e]]) {
      const k = JSON.stringify(p)
      if (!seen.has(k)) {
        seen.add(k)
        try {
          void queryClient.invalidateQueries({ queryKey: p }).catch((err) => {
            logger.debug('[entitySync] batch invalidate failed (non-fatal)', { err, key: p })
          })
        } catch (err) {
          logger.debug('[entitySync] batch invalidate threw (non-fatal)', { err, key: p })
        }
      }
    }
    try {
      window.dispatchEvent(new CustomEvent(entityWindowEvent(e), { detail: detail ?? {} }))
    } catch (err) {
      logger.debug('[entitySync] batch dispatch failed (non-fatal)', { err, entity: e })
    }
  }
  try {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] }).catch((err) => {
      logger.debug('[entitySync] batch dashboard invalidate failed (non-fatal)', { err })
    })
  } catch (err) {
    logger.debug('[entitySync] batch dashboard invalidate threw (non-fatal)', { err })
  }
}

/**
 * Subscribe a manual (useState/useEffect) page to entity freshness.
 * Listens to window events (same-tab mutations + Layout socket bridge) AND
 * socket events directly (covers pages mounted before Layout bridge ran).
 * Debounces rapid bursts via rAF-less micro-coalescing: multiple events in
 * the same tick trigger ONE refetch.
 */
export function useEntitySync(
  entities: EntityKind | EntityKind[],
  refetch: () => void | Promise<unknown>,
) {
  const list = Array.isArray(entities) ? entities : [entities]
  const ref = useRef(refetch)
  ref.current = refetch

  useEffect(() => {
    let queued = false
    const run = () => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        try {
          const r = ref.current()
          if (r && typeof (r as Promise<unknown>).catch === 'function') {
            ;(r as Promise<unknown>).catch((err) => {
              logger.debug('[entitySync] refetch failed (non-fatal)', { err })
            })
          }
        } catch (err) {
          logger.debug('[entitySync] refetch threw (non-fatal)', { err })
        }
      })
    }
    const cleanups: Array<() => void> = []
    for (const e of list) {
      const winEv = entityWindowEvent(e)
      const wl = () => run()
      window.addEventListener(winEv as any, wl as any)
      cleanups.push(() => window.removeEventListener(winEv as any, wl as any))
      // Socket parity: backend global broadcast reaches other devices/tabs.
      try {
        const s = getSocket()
        if (s) {
          const evs = SOCKET_EVENTS[e] ?? []
          const sl = () => run()
          for (const sev of evs) s.on(sev, sl)
          cleanups.push(() => { for (const sev of evs) { try { s.off(sev, sl) } catch (err) { logger.debug('[entitySync] socket off failed', { err, sev }) } } })
        }
      } catch (err) {
        logger.debug('[entitySync] socket subscribe failed (non-fatal)', { err })
      }
    }
    // Cross-tab via storage-less broadcast: other tabs dispatch the same
    // window event through Layout's socket bridge, already covered above.
    // `focus` revalidates after tab-switch without polling.
    const onFocus = () => run()
    window.addEventListener('focus', onFocus)
    cleanups.push(() => window.removeEventListener('focus', onFocus))
    return () => { cleanups.forEach((fn) => { try { fn() } catch (err) { logger.debug('[entitySync] cleanup failed', { err }) } }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.join('|')])
}

/** All socket events Layout must bridge → window (single place, no per-page drift). */
export const ALL_BRIDGED_SOCKET_EVENTS: string[] = Array.from(
  new Set(Object.values(SOCKET_EVENTS).flat()),
)

/**
 * STATE-SYNC FIX: socket event → canonical entity (single mapping).
 * Layout previously had its own hand-rolled `socketToWindow` map + bespoke
 * prefix invalidations that drifted from RELATED_PREFIXES
 * (dead ['assignmentHubs'] key, missing search/counts/tasks/timetable fan-out).
 * Bridging via `notifyEntityMutated` keeps ONE invalidation table.
 */
const SOCKET_TO_ENTITY: Array<{ prefix: string; entity: EntityKind }> = [
  { prefix: 'announcement:', entity: 'announcement' },
  { prefix: 'assignment:', entity: 'assignment' },
  { prefix: 'task:', entity: 'task' },
  { prefix: 'schedule:', entity: 'schedule' },
  { prefix: 'calendar:', entity: 'schedule' },
  { prefix: 'timetable:', entity: 'schedule' },
  { prefix: 'hackathon:', entity: 'hackathon' },
  { prefix: 'internship:', entity: 'internship' },
  { prefix: 'contest:', entity: 'contest' },
  { prefix: 'coding:profile', entity: 'coding-profile' },
  { prefix: 'coding-profile', entity: 'coding-profile' },
  { prefix: 'form:', entity: 'form' },
  // PERPAGE-HALF1: room:message:* MUST precede 'room:' (prefix match is
  // first-hit). Chat traffic is high-volume; routing it to 'message' keeps
  // room-metadata subscribers (detail pages) quiet while RQ lists still
  // bust via RELATED 'message' → ['rooms'] when stale.
  { prefix: 'room:message', entity: 'message' },
  { prefix: 'room:', entity: 'room' },
  { prefix: 'attendance:', entity: 'attendance' },
  { prefix: 'grade:', entity: 'grade' },
  { prefix: 'report:', entity: 'report' },
  { prefix: 'notification:', entity: 'notification' },
  { prefix: 'college:', entity: 'college' },
  { prefix: 'user:', entity: 'user' },
  { prefix: 'department:', entity: 'department' },
]

export function entityForSocketEvent(socketEvent: string): EntityKind | null {
  for (const { prefix, entity } of SOCKET_TO_ENTITY) {
    if (socketEvent.startsWith(prefix)) return entity
  }
  return null
}

/**
 * Bridge ONE socket broadcast → canonical window event + RQ invalidation.
 * Layout calls this for every ALL_BRIDGED_SOCKET_EVENTS entry.
 */
export function bridgeSocketEvent(socketEvent: string, payload?: Record<string, unknown>) {
  const entity = entityForSocketEvent(socketEvent)
  if (!entity) return
  notifyEntityMutated(entity, payload as any)
}

/**
 * Shared helpers for assignment submission channel & badge styling.
 * Single source of truth for legacy fallback heuristic.
 */

export type SubmissionLike = {
  submissionChannel?: string | null
  fileUrl?: string | null
  offlineNote?: string | null
}

export function getSubmissionChannel(s: SubmissionLike): 'ONLINE' | 'OFFLINE' {
  return (s.submissionChannel as 'ONLINE' | 'OFFLINE') || (s.fileUrl ? 'ONLINE' : s.offlineNote ? 'OFFLINE' : 'ONLINE')
}

export function channelBadgeClasses(isOffline: boolean): string {
  return isOffline
    ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700'
}

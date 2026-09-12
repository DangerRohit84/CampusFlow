// services/notify/chunked.ts — chunked notify pipeline (SRP extract).
// WHY: notifyUsers chunking (500/chunk) + online-guard fan-out was inline in
// notificationService.ts. Pure chunk() here is unit-testable; service keeps
// the Prisma + socket wiring (behavior identical).

export const NOTIFY_CHUNK_SIZE = 500

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)].filter(Boolean)
}

/**
 * Prisma error-code helpers — 404-vs-500 mapping (topbottom-backend audit).
 *
 * Local catch blocks across routes returned 500 for missing rows (P2025) and
 * FK races (P2003). P2025 on a scoped `where:{id,userId}` update/delete means
 * "not found or not yours" — that is a 404, never a 500. Verified against the
 * REAL `@prisma/client` (v6 accepts `{id,userId}` in update/delete where;
 * missing rows surface as P2025 `RecordNotFound`, not validation errors).
 * Pure + hermetic (no DB) — safe to unit test.
 */

/** True when err is a Prisma "record not found" (update/delete/upsert on missing row). */
export function isPrismaNotFound(err: unknown): boolean {
  return (err as any)?.code === 'P2025';
}

/** True when err is a Prisma FK violation (related row missing / race). */
export function isPrismaFkViolation(err: unknown): boolean {
  return (err as any)?.code === 'P2003';
}

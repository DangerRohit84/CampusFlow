// services/platforms/registry.ts — OCP Strategy registry for coding platforms.
// WHY: platformFetchers.fetchAllPlatforms + platformStats.fetchAllPlatformStats
// each had `if (profile.xHandle)` ×5. Adding GFG-v2 edited 2+ files with
// silent-skip risk. Registry: new platform = one registration line.

export type PlatformFetchFn<T> = (handle: string) => Promise<T>

export interface PlatformEntry<T> {
  /** profile key, e.g. 'codeforcesHandle' */
  profileKey: string
  /** short code, e.g. 'codeforces' */
  code: string
  fetch: PlatformFetchFn<T>
}

export class PlatformRegistry<T> {
  private entries: PlatformEntry<T>[] = []
  register(entry: PlatformEntry<T>): void {
    this.entries.push(entry)
  }
  list(): ReadonlyArray<PlatformEntry<T>> {
    return this.entries
  }
  clearForTests(): void {
    this.entries = []
  }
  /** Build lazy tasks for handles present on profile (bounded-concurrency ready). */
  tasksFor(profile: Record<string, string | null | undefined>): Array<() => Promise<T>> {
    const tasks: Array<() => Promise<T>> = []
    for (const e of this.entries) {
      const h = profile[e.profileKey]
      if (h) {
        const handle: string = h
        const fn = e.fetch
        tasks.push(() => fn(handle))
      }
    }
    return tasks
  }
}

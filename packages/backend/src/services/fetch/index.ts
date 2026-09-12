// services/fetch/index.ts — barrel for fetch domain (SRP split).
// New code imports from here; routes/fetch.ts re-exports saveItems for compat.
export { saveItems } from './save';
export type { SaveItemsDb, SaveItemsResult } from './save';
export { normalizeFetchLimits } from './limits';
export type { PlatformSettingRow } from './limits';
export {
  deriveSourceStatus,
  normalizePlatformKey,
  unknownHealth,
  selectFailedPlatforms,
  recordSourceRun,
  sourceHealthStore,
  createInMemorySourceHealthStore,
  PrismaSourceHealthStore,
  InMemorySourceHealthStore,
  SLOW_FETCH_MS,
  DOWN_AFTER_CONSECUTIVE_FAILS,
  DEGRADED_BELOW_SUCCESS_RATE,
} from './health';
export type { SourceHealthRecord, SourceHealthStore, SourceStatus, RecordRunInput } from './health';

/**
 * IndexedDB helper for persisting original uploaded resume blob (PDF/DOCX)
 * Falls back to localStorage dataUrl for small files; DB gives ~50MB quota vs 5MB localStorage
 */
const DB_NAME = 'campusflow-resume-db'
const STORE_NAME = 'originalAssets'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export type StoredAssetBlob = {
  userId: string
  fileName: string
  mimeType: string
  size: number
  blob: Blob
  uploadedAt: string
}

export async function saveOriginalAssetBlob(userId: string, file: File | Blob, fileName: string, mimeType: string): Promise<void> {
  try {
    const db = await openDB()
    const blob = file instanceof Blob ? file : new Blob([file as any], { type: mimeType })
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const record: StoredAssetBlob = { userId, fileName, mimeType, size: blob.size, blob, uploadedAt: new Date().toISOString() }
      const req = store.put(record)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => db.close()
      tx.onerror = () => { try { db.close() } catch {} }
    })
  } catch (e) {
    console.warn('saveOriginalAssetBlob failed', e)
  }
}

export async function loadOriginalAssetBlob(userId: string): Promise<StoredAssetBlob | null> {
  try {
    const db = await openDB()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(userId)
      req.onsuccess = () => {
        const val = req.result as StoredAssetBlob | undefined
        resolve(val || null)
      }
      req.onerror = () => resolve(null)
      tx.oncomplete = () => db.close()
    })
  } catch {
    return null
  }
}

export async function clearOriginalAssetBlob(userId: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(userId)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { try { db.close() } catch {}; resolve() }
    })
  } catch {}
}

export async function createObjectUrlFromBlob(blob: Blob): Promise<string> {
  return URL.createObjectURL(blob)
}

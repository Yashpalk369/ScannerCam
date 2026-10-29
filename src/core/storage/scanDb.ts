import { openDB, type IDBPDatabase } from 'idb'
import type { ScanPage } from '../cv/types'

const DB_NAME = 'scannercam_db'
const DB_VERSION = 2
const STORE_PAGES = 'scanned_pages'
const STORE_META = 'session_meta'

export class SessionConflictError extends Error {
  constructor() { super('The saved session changed in another tab.'); this.name = 'SessionConflictError' }
}

export class StorageUpgradeBlockedError extends Error {
  constructor() { super('Another tab is blocking the storage upgrade.'); this.name = 'StorageUpgradeBlockedError' }
}

interface DbPageRecord {
  id: string
  name: string
  blob: Blob
  rawBlob: Blob
  width: number
  height: number
  rawWidth: number
  rawHeight: number
  filter: ScanPage['filter']
  quad: ScanPage['quad']
  order: number
  createdAt: number
}

class ScanDatabase {
  private dbPromise: Promise<IDBPDatabase> | null = null

  private getDb(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      let timedOut = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let rejectBlocked!: (reason: Error) => void
      const blocked = new Promise<never>((_resolve, reject) => { rejectBlocked = reject })
      const opening = openDB(DB_NAME, DB_VERSION, {
        blocked() {
          if (!timer) timer = setTimeout(() => {
            timedOut = true
            rejectBlocked(new StorageUpgradeBlockedError())
          }, 2500)
        },
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
          if (!db.objectStoreNames.contains(STORE_PAGES)) {
            const store = db.createObjectStore(STORE_PAGES, { keyPath: 'id' })
            store.createIndex('by-order', 'order')
          }
        },
      })
      // A blocked open cannot be cancelled. Close it if it eventually succeeds
      // after the caller has already fallen back to an in-memory session.
      void opening.then(db => {
        if (timer) clearTimeout(timer)
        if (timedOut) db.close()
      }, () => { if (timer) clearTimeout(timer) })
      this.dbPromise = Promise.race([opening, blocked]).catch(error => {
        this.dbPromise = null
        throw error
      })
    }
    return this.dbPromise
  }

  async saveAllPages(pages: ScanPage[], expectedRevision?: number): Promise<number> {
    const db = await this.getDb()
    const tx = db.transaction([STORE_PAGES, STORE_META], 'readwrite')
    const store = tx.objectStore(STORE_PAGES)
    const meta = tx.objectStore(STORE_META)
    const revision: number = (await meta.get('revision')) ?? 0
    if (expectedRevision !== undefined && revision !== expectedRevision) {
      await tx.done
      throw new SessionConflictError()
    }
    await store.clear()

    for (let i = 0; i < pages.length; i += 1) {
      const p = pages[i]
      const record: DbPageRecord = {
        id: p.id,
        name: p.name,
        blob: p.blob,
        rawBlob: p.rawBlob,
        width: p.width,
        height: p.height,
        rawWidth: p.rawWidth,
        rawHeight: p.rawHeight,
        filter: p.filter,
        quad: p.quad,
        order: i,
        createdAt: p.createdAt,
      }
      await store.put(record)
    }

    await meta.put(revision + 1, 'revision')
    await tx.done
    return revision + 1
  }

  async loadAllPages(): Promise<ScanPage[]> {
    return (await this.loadSnapshot()).pages
  }

  async loadSnapshot(): Promise<{ pages: ScanPage[]; revision: number }> {
    const db = await this.getDb()
    const tx = db.transaction([STORE_PAGES, STORE_META], 'readonly')
    const records = await tx.objectStore(STORE_PAGES).index('by-order').getAll()
    const revision: number = (await tx.objectStore(STORE_META).get('revision')) ?? 0
    await tx.done
    const pages = records.map((rec: DbPageRecord) => ({
      id: rec.id,
      name: rec.name,
      blob: rec.blob,
      rawBlob: rec.rawBlob,
      previewUrl: URL.createObjectURL(rec.blob),
      width: rec.width,
      height: rec.height,
      rawWidth: rec.rawWidth,
      rawHeight: rec.rawHeight,
      filter: rec.filter,
      quad: rec.quad,
      createdAt: rec.createdAt,
    }))
    return { pages, revision }
  }

  async deletePage(id: string): Promise<void> {
    const db = await this.getDb()
    await db.delete(STORE_PAGES, id)
  }

  async clearAll(expectedRevision?: number): Promise<number> {
    return this.saveAllPages([], expectedRevision)
  }
}

export const scanDb = new ScanDatabase()

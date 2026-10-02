import { openDB, type IDBPDatabase } from 'idb'
import type { ScanPage } from '../cv/types'

const DB_NAME = 'scannercam_db'
const DB_VERSION = 1
const STORE_PAGES = 'scanned_pages'

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
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(STORE_PAGES)) {
            const store = db.createObjectStore(STORE_PAGES, { keyPath: 'id' })
            store.createIndex('by-order', 'order')
          }
        },
      })
    }
    return this.dbPromise
  }

  async saveAllPages(pages: ScanPage[]): Promise<void> {
    const db = await this.getDb()
    const tx = db.transaction(STORE_PAGES, 'readwrite')
    await tx.store.clear()

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
      await tx.store.put(record)
    }

    await tx.done
  }

  async loadAllPages(): Promise<ScanPage[]> {
    const db = await this.getDb()
    const records = await db.getAllFromIndex(STORE_PAGES, 'by-order')

    return records.map((rec: DbPageRecord) => ({
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
  }

  async deletePage(id: string): Promise<void> {
    const db = await this.getDb()
    await db.delete(STORE_PAGES, id)
  }

  async clearAll(): Promise<void> {
    const db = await this.getDb()
    await db.clear(STORE_PAGES)
  }
}

export const scanDb = new ScanDatabase()

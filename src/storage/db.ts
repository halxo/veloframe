import type { AssetRecord, Presentation } from '../model/types';

const DB_NAME = 'veloframe_local_db';
const DB_VERSION = 1;
const STORE_PRESENTATIONS = 'presentations';
const STORE_ASSETS = 'assets';

/**
 * Local-first IndexedDB persistence layer for presentations and binary/dataURL image assets.
 * Provides instant offline autosave and zero-latency retrieval.
 */
export class VeloFrameDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PRESENTATIONS)) {
          const store = db.createObjectStore(STORE_PRESENTATIONS, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async savePresentation(presentation: Presentation): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRESENTATIONS, 'readwrite');
      tx.objectStore(STORE_PRESENTATIONS).put(presentation);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getPresentation(id: string): Promise<Presentation | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRESENTATIONS, 'readonly');
      const req = tx.objectStore(STORE_PRESENTATIONS).get(id);
      req.onsuccess = () => resolve((req.result as Presentation | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listPresentations(): Promise<Presentation[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRESENTATIONS, 'readonly');
      const req = tx.objectStore(STORE_PRESENTATIONS).getAll();
      req.onsuccess = () => {
        const items = (req.result as Presentation[]) ?? [];
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deletePresentation(id: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PRESENTATIONS, 'readwrite');
      tx.objectStore(STORE_PRESENTATIONS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveAsset(asset: AssetRecord): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.objectStore(STORE_ASSETS).put(asset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAsset(id: string): Promise<AssetRecord | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_ASSETS).get(id);
      req.onsuccess = () => resolve((req.result as AssetRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllAssets(): Promise<AssetRecord[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const req = tx.objectStore(STORE_ASSETS).getAll();
      req.onsuccess = () => resolve((req.result as AssetRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }
}

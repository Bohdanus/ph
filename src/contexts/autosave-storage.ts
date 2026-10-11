import type { DocumentFrame } from './document-frame.ts';
import type { ToolName } from './tool-types.ts';
import type { Size } from './general-types.ts';

const DB_NAME = 'lightshop-autosave';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const KEY_CURRENT = 'current';

export interface AutosaveMetadata {
  fileName: string;
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  historyIndex: number;
  toolName: ToolName;
  color: string;
  backgroundColor: string;
  totalSize: Size;
  documentFrame: DocumentFrame;
  savedAt: number;
}

export interface AutosaveRecord {
  metadata: AutosaveMetadata;
  buffer: ArrayBuffer;
}

type DbState =
  | { status: 'unavailable' }
  | { status: 'opening'; ready: Promise<IDBDatabase> }
  | { status: 'ready'; db: IDBDatabase }
  | { status: 'error'; error: Error };

let dbState: DbState = { status: 'unavailable' };

if (typeof indexedDB !== 'undefined') {
  dbState = {
    status: 'opening',
    ready: new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        dbState = { status: 'ready', db };
        resolve(db);
      };
      request.onerror = () => {
        const error = new Error(request.error?.message ?? 'IndexedDB open failed');
        dbState = { status: 'error', error };
        reject(error);
      };
    }),
  };
}

async function getDb(): Promise<IDBDatabase> {
  if (dbState.status === 'ready') return dbState.db;
  if (dbState.status === 'error') throw dbState.error;
  if (dbState.status === 'opening') return dbState.ready;
  throw new Error('IndexedDB is not available');
}

export async function saveAutosave(record: AutosaveRecord): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put({ key: KEY_CURRENT, ...record });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(KEY_CURRENT);
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        resolve(null);
        return;
      }
      resolve({ metadata: result.metadata as AutosaveMetadata, buffer: result.buffer as ArrayBuffer });
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.delete(KEY_CURRENT);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // If the database is unavailable or still opening, there is nothing to
    // clear — resolve silently so callers are never blocked by a missing store.
  }
}

export async function hasAutosave(): Promise<boolean> {
  try {
    const db = await getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count(KEY_CURRENT);
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return false;
  }
}

export function isAutosaveAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

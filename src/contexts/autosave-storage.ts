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
  const ready = new Promise<IDBDatabase>((resolve, reject) => {
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
  });
  // Opening can fail before a caller requests the database. Mark the shared promise observed;
  // callers still receive the same rejection through getDb().
  void ready.catch(() => undefined);
  dbState = { status: 'opening', ready };
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
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const store = transaction.objectStore(STORE_NAME);
    store.put({ key: KEY_CURRENT, ...record });
    transaction.oncomplete = resolveOnce;
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Autosave save transaction failed'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Autosave save transaction aborted'));
  });
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  const db = await getDb();
  return new Promise<AutosaveRecord | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    let settled = false;
    const resolveOnce = (record: AutosaveRecord | null) => {
      if (settled) return;
      settled = true;
      resolve(record);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let record: AutosaveRecord | null = null;
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(KEY_CURRENT);
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        return;
      }
      record = { metadata: result.metadata as AutosaveMetadata, buffer: result.buffer as ArrayBuffer };
    };
    request.onerror = () => {
      rejectOnce(transaction.error ?? request.error ?? new Error('Autosave read request failed'));
    };
    transaction.oncomplete = () => resolveOnce(record);
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Autosave load transaction failed'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Autosave load transaction aborted'));
  });
}

export async function clearAutosave(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await getDb();
  } catch {
    // An unavailable database has no clearable record; transaction failures below still propagate.
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    let settled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const store = transaction.objectStore(STORE_NAME);
    store.delete(KEY_CURRENT);
    transaction.oncomplete = resolveOnce;
    transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Autosave clear transaction failed'));
    transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Autosave clear transaction aborted'));
  });
}

export async function hasAutosave(): Promise<boolean> {
  try {
    const db = await getDb();
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      let settled = false;
      const resolveOnce = (exists: boolean) => {
        if (settled) return;
        settled = true;
        resolve(exists);
      };
      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count(KEY_CURRENT);
      let exists = false;
      request.onsuccess = () => {
        exists = request.result > 0;
      };
      transaction.oncomplete = () => resolveOnce(exists);
      request.onerror = () =>
        rejectOnce(transaction.error ?? request.error ?? new Error('Autosave count request failed'));
      transaction.onerror = () => rejectOnce(transaction.error ?? new Error('Autosave count transaction failed'));
      transaction.onabort = () => rejectOnce(transaction.error ?? new Error('Autosave count transaction aborted'));
    });
  } catch {
    return false;
  }
}

export function isAutosaveAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

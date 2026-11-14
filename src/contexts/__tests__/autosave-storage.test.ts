import { describe, expect, it, vi } from 'vitest';

import type { AutosaveMetadata, AutosaveRecord } from '../autosave-storage.ts';

const TEST_BUFFER = new ArrayBuffer(8);

const baseMetadata: AutosaveMetadata = {
  fileName: 'test.psd',
  documentId: 'doc-1',
  documentRevision: 1,
  branchRevision: 0,
  historyIndex: 0,
  toolName: 'reposition',
  color: '#000000',
  backgroundColor: '#ffffff',
  totalSize: { width: 800, height: 600 },
  documentFrame: { x: 0, y: 0, width: 800, height: 600 },
  savedAt: 1234567890,
};

const baseRecord: AutosaveRecord = { metadata: baseMetadata, buffer: TEST_BUFFER };

type StorageModule = typeof import('../autosave-storage.ts');

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal in-memory IndexedDB mock. IndexedDB request and transaction events are
 * dispatched as tasks, so use timers instead of microtasks to keep their ordering
 * distinct from promise callbacks.
 */
function makeMockIDB(
  data = new Map<string, unknown>(),
  options: {
    countError?: Error;
    clearTransactionError?: Error;
    countTransactionErrorAfterRequest?: Error;
    loadRequestError?: Error;
    loadTransactionError?: Error;
    loadTransactionErrorAfterRequest?: Error;
    openError?: Error;
    saveTransactionError?: Error;
  } = {}
): any {
  const mockDB = {
    createObjectStore: () => {},
    transaction: (_name: string, mode: string): any => {
      const clearTransactionError = mode === 'readwrite' ? options.clearTransactionError : undefined;
      const transactionAbortError = mode === 'readwrite' ? options.saveTransactionError : options.loadTransactionError;
      const state: { store?: any } = {};
      const transaction: any = {
        error: null,
        objectStore: () => state.store,
      };
      const scheduleComplete = () =>
        setTimeout(() => {
          if (transaction.oncomplete) transaction.oncomplete({} as Event);
        }, 0);
      // Simulate an explicit transaction abort before a request error; this path reports abort only.
      const scheduleAbort = (error: Error) =>
        setTimeout(() => {
          transaction.error = error;
          if (transaction.onabort) transaction.onabort({} as Event);
        });
      const store = {
        put: (obj: any) => {
          const req: any = {};
          if (transactionAbortError) {
            scheduleAbort(transactionAbortError);
          } else {
            data.set(obj.key, obj);
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
            }, 0);
            scheduleComplete();
          }
          return req;
        },
        get: (key: string) => {
          const result = data.get(key);
          const loadRequestError = mode === 'readonly' ? options.loadRequestError : undefined;
          const loadTransactionErrorAfterRequest =
            mode === 'readonly' ? options.loadTransactionErrorAfterRequest : undefined;
          const req: any = { result, error: loadRequestError ?? null };
          if (loadRequestError) {
            setTimeout(() => {
              if (req.onerror) req.onerror({} as Event);
              transaction.error = loadRequestError;
              if (transaction.onerror) transaction.onerror({} as Event);
              scheduleAbort(loadRequestError);
            }, 0);
          } else if (loadTransactionErrorAfterRequest) {
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
              scheduleAbort(loadTransactionErrorAfterRequest);
            }, 0);
          } else if (transactionAbortError) {
            scheduleAbort(transactionAbortError);
          } else {
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
            }, 0);
            scheduleComplete();
          }
          return req;
        },
        delete: (key: string) => {
          const req: any = {};
          if (clearTransactionError) {
            req.error = clearTransactionError;
            setTimeout(() => {
              if (req.onerror) req.onerror({} as Event);
              transaction.error = clearTransactionError;
              if (transaction.onerror) transaction.onerror({} as Event);
              // IndexedDB dispatches the bubbling request error before the later transaction abort task.
              scheduleAbort(clearTransactionError);
            }, 0);
          } else if (transactionAbortError) {
            scheduleAbort(transactionAbortError);
          } else {
            data.delete(key);
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
            }, 0);
            scheduleComplete();
          }
          return req;
        },
        count: (key: string) => {
          const result = data.has(key) ? 1 : 0;
          const countError = options.countError;
          const countTransactionErrorAfterRequest = options.countTransactionErrorAfterRequest;
          const req: any = { result, error: countError ?? null };
          if (countError) {
            setTimeout(() => {
              if (req.onerror) req.onerror({} as Event);
              transaction.error = countError;
              if (transaction.onerror) transaction.onerror({} as Event);
              scheduleAbort(countError);
            }, 0);
          } else if (countTransactionErrorAfterRequest) {
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
              scheduleAbort(countTransactionErrorAfterRequest);
            }, 0);
          } else if (transactionAbortError) {
            scheduleAbort(transactionAbortError);
          } else {
            setTimeout(() => {
              if (req.onsuccess) req.onsuccess({} as Event);
            }, 0);
            scheduleComplete();
          }
          return req;
        },
      };

      state.store = store;
      return transaction;
    },
  };

  const openRequest: any = {
    result: mockDB,
    error: options.openError ?? null,
  };

  return {
    open: (): any => {
      setTimeout(() => {
        if (options.openError) {
          if (openRequest.onerror) openRequest.onerror({} as Event);
        } else {
          if (openRequest.onupgradeneeded) openRequest.onupgradeneeded({} as Event);
          if (openRequest.onsuccess) openRequest.onsuccess({} as Event);
        }
      }, 0);
      return openRequest;
    },
    deleteDatabase: vi.fn(),
    cmp: vi.fn(),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

describe('autosave-storage: IndexedDB unavailable', () => {
  let storage: StorageModule;
  let prevIndexedDB: unknown;

  beforeEach(async () => {
    prevIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
    delete (globalThis as Record<string, unknown>).indexedDB;
    vi.resetModules();
    storage = await import('../autosave-storage.ts');
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = prevIndexedDB;
    vi.resetModules();
  });

  it('isAutosaveAvailable returns false', () => {
    expect(storage.isAutosaveAvailable()).toBe(false);
  });

  it('loadAutosave rejects with not-available error', async () => {
    await expect(storage.loadAutosave()).rejects.toThrow('not available');
  });

  it('saveAutosave rejects with not-available error', async () => {
    await expect(storage.saveAutosave(baseRecord)).rejects.toThrow('not available');
  });

  it('clearAutosave resolves silently (does not throw)', async () => {
    await expect(storage.clearAutosave()).resolves.toBeUndefined();
  });

  it('hasAutosave resolves false', async () => {
    await expect(storage.hasAutosave()).resolves.toBe(false);
  });
});

describe('autosave-storage: IndexedDB available', () => {
  let storage: StorageModule;
  let data: Map<string, unknown>;
  let prevIndexedDB: unknown;

  beforeEach(async () => {
    data = new Map();
    prevIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data);
    vi.resetModules();
    storage = await import('../autosave-storage.ts');
    // Drain microtasks so the open promise resolves
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).indexedDB = prevIndexedDB;
    vi.resetModules();
  });

  it('isAutosaveAvailable returns true', () => {
    expect(storage.isAutosaveAvailable()).toBe(true);
  });

  it('returns null from loadAutosave when no record exists', async () => {
    const result = await storage.loadAutosave();
    expect(result).toBe(null);
  });

  it('saves and loads a record', async () => {
    await storage.saveAutosave(baseRecord);
    const loaded = await storage.loadAutosave();
    expect(loaded).toEqual(baseRecord);
  });

  it('saveAutosave rejects when its transaction aborts', async () => {
    const transactionError = new Error('save transaction aborted');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      saveTransactionError: transactionError,
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.saveAutosave(baseRecord)).rejects.toBe(transactionError);
  });

  it('loadAutosave rejects when its transaction aborts before the read completes', async () => {
    const transactionError = new Error('load transaction aborted');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      loadTransactionError: transactionError,
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.loadAutosave()).rejects.toBe(transactionError);
  });

  it('loadAutosave waits for the transaction to complete after the read request succeeds', async () => {
    const transactionError = new Error('transaction aborted after read');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      loadTransactionErrorAfterRequest: transactionError,
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.loadAutosave()).rejects.toBe(transactionError);
  });

  it('loadAutosave rejects when its read request fails', async () => {
    const requestError = new Error('read request failed');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, { loadRequestError: requestError });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.loadAutosave()).rejects.toBe(requestError);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  it('clearAutosave removes the record', async () => {
    await storage.saveAutosave(baseRecord);
    await vi.waitFor(async () => {
      const loaded = await storage.loadAutosave();
      expect(loaded).toEqual(baseRecord);
    });

    await storage.clearAutosave();

    const loaded = await storage.loadAutosave();
    expect(loaded).toBe(null);
  });

  it('hasAutosave returns true when a record exists', async () => {
    await storage.saveAutosave(baseRecord);
    await vi.waitFor(() => expect(storage.hasAutosave()).resolves.toBe(true));
  });

  it('hasAutosave returns false when no record exists', async () => {
    await expect(storage.hasAutosave()).resolves.toBe(false);
  });

  it('observes a failed database open before the first storage call', async () => {
    const openError = new Error('database open failed');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, { openError });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    // Let the open request fail for a full task turn before any caller observes the shared promise.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    await expect(storage.loadAutosave()).rejects.toThrow('database open failed');
    await expect(storage.saveAutosave(baseRecord)).rejects.toThrow('database open failed');
    await expect(storage.hasAutosave()).resolves.toBe(false);
    await expect(storage.clearAutosave()).resolves.toBeUndefined();
  });

  it('hasAutosave resolves false when the count request errors', async () => {
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      countError: new Error('count request failed'),
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.hasAutosave()).resolves.toBe(false);
    // Let the abort task run after the bubbling request and transaction error events.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  it('hasAutosave resolves false when the transaction aborts after the count request succeeds', async () => {
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      countTransactionErrorAfterRequest: new Error('transaction aborted after count'),
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.hasAutosave()).resolves.toBe(false);
  });

  it('clearAutosave rejects when its delete request fails', async () => {
    const transactionError = new Error('clear transaction failed');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, { clearTransactionError: transactionError });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.clearAutosave()).rejects.toBe(transactionError);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });

  it('clearAutosave rejects when its transaction aborts without a request error', async () => {
    const transactionError = new Error('clear transaction aborted');
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(data, {
      saveTransactionError: transactionError,
    });
    vi.resetModules();
    storage = await import('../autosave-storage.ts');

    await expect(storage.clearAutosave()).rejects.toBe(transactionError);
  });

  it('overwrite replaces the existing record', async () => {
    await storage.saveAutosave(baseRecord);

    const updatedMetadata: AutosaveMetadata = { ...baseMetadata, fileName: 'updated.psd' };
    await storage.saveAutosave({ metadata: updatedMetadata, buffer: new ArrayBuffer(4) });

    const loaded = await storage.loadAutosave();
    expect(loaded?.metadata.fileName).toBe('updated.psd');
  });
});

describe('autosave-storage: DB opening race fix', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).indexedDB;
    vi.resetModules();
  });

  it('loadAutosave waits for DB to open before reading', async () => {
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB();
    vi.resetModules();

    // Import and immediately call loadAutosave — the DB may still be opening.
    const storage = await import('../autosave-storage.ts');
    const loaded = await storage.loadAutosave();
    expect(loaded).toBe(null);
  });

  it('saveAutosave waits for DB to open before writing', async () => {
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB(new Map());
    vi.resetModules();

    const storage = await import('../autosave-storage.ts');
    await storage.saveAutosave(baseRecord);

    const loaded = await storage.loadAutosave();
    expect(loaded).toEqual(baseRecord);
  });

  it('loadAutosave resolves after saveAutosave back-to-back', async () => {
    (globalThis as Record<string, unknown>).indexedDB = makeMockIDB();
    vi.resetModules();

    const storage = await import('../autosave-storage.ts');
    await storage.saveAutosave(baseRecord);
    const loaded = await storage.loadAutosave();
    expect(loaded).toEqual(baseRecord);
  });
});

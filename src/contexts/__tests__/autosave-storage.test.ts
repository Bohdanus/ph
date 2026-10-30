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
 * Minimal in-memory IndexedDB mock. The open() call returns a request whose
 * onsuccess fires on the next microtask (after the caller has had a chance to
 * attach event handlers), mirroring real IndexedDB's async contract.
 */
function makeMockIDB(data = new Map<string, unknown>()): any {
  const mockDB = {
    createObjectStore: () => {},
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- matches real IndexedDB signature
    transaction: (_name: string, _mode: string): any => {
      const store = {
        put: (obj: any) => {
          data.set(obj.key, obj);
          const req: any = {};
          queueMicrotask(() => req.onsuccess && req.onsuccess({} as Event));
          return req;
        },
        get: (key: string) => {
          const result = data.get(key);
          const req: any = { result };
          queueMicrotask(() => req.onsuccess && req.onsuccess({} as Event));
          return req;
        },
        delete: (key: string) => {
          data.delete(key);
          const req: any = {};
          queueMicrotask(() => req.onsuccess && req.onsuccess({} as Event));
          return req;
        },
        count: (key: string) => {
          const result = data.has(key) ? 1 : 0;
          const req: any = { result };
          queueMicrotask(() => req.onsuccess && req.onsuccess({} as Event));
          return req;
        },
      };

      const tx: any = {
        objectStore: () => store,
      };
      queueMicrotask(() => {
        if (tx.oncomplete) tx.oncomplete({} as Event);
      });
      return tx;
    },
  };

  const openRequest: any = {
    result: mockDB,
    error: null,
  };

  return {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- matches real IndexedDB signature
    open: (_name: string, _version: number): any => {
      queueMicrotask(() => {
        if (openRequest.onupgradeneeded) openRequest.onupgradeneeded({} as Event);
        if (openRequest.onsuccess) openRequest.onsuccess({} as Event);
      });
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

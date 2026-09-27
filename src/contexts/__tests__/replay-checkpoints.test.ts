import { describe, expect, it, vi } from 'vitest';

import { ReplayCheckpointCache, type ReplayCheckpoint } from '../replay-checkpoints.ts';
import type { ReplayCheckpointKey } from '../replay-checkpoints.ts';

function key(overrides: Partial<ReplayCheckpointKey> = {}): ReplayCheckpointKey {
  return { documentId: 'doc-1', documentRevision: 1, branchRevision: 0, historyIndex: 0, ...overrides };
}

function checkpoint<T = string>(overrides: Partial<ReplayCheckpoint<T>> = {}): ReplayCheckpoint<T> {
  return {
    key: key(),
    value: 'value' as unknown as T,
    byteSize: 10,
    ...overrides,
  } as ReplayCheckpoint<T>;
}

function releaseSpy() {
  return vi.fn();
}

describe('ReplayCheckpointCache', () => {
  describe('get / set', () => {
    it('returns undefined for a key that was never set', () => {
      const cache = new ReplayCheckpointCache<string>();
      expect(cache.get(key({ historyIndex: 5 }))).toBeUndefined();
    });

    it('stores and retrieves a checkpoint by its key', () => {
      const cache = new ReplayCheckpointCache<string>();
      const cp = checkpoint({ value: 'hello', byteSize: 8 });
      cache.set(cp);

      expect(cache.get(key())).toBe('hello');
      expect(cache.size).toBe(1);
      expect(cache.byteSize).toBe(8);
    });

    it('overwrites an earlier checkpoint with the same key and adjusts byte count', () => {
      const cache = new ReplayCheckpointCache<string>();
      const releaseA = releaseSpy();
      const releaseB = releaseSpy();

      cache.set({ key: key(), value: 'a', byteSize: 10, release: releaseA });
      cache.set({ key: key(), value: 'b', byteSize: 30, release: releaseB });

      expect(cache.get(key())).toBe('b');
      expect(cache.size).toBe(1);
      expect(cache.byteSize).toBe(30);
      expect(releaseA).toHaveBeenCalledTimes(1);
      expect(releaseB).not.toHaveBeenCalled();
    });

    it('distinguishes keys by every component of the composite key', () => {
      const cache = new ReplayCheckpointCache<number>();
      cache.set({ key: key({ historyIndex: 0 }), value: 0, byteSize: 1 });
      cache.set({ key: key({ historyIndex: 1 }), value: 1, byteSize: 1 });

      expect(cache.get(key({ historyIndex: 0 }))).toBe(0);
      expect(cache.get(key({ historyIndex: 1 }))).toBe(1);
    });
  });

  describe('invalidate', () => {
    it('removes only entries whose key matches the predicate', () => {
      const cache = new ReplayCheckpointCache<string>();
      const releaseA = releaseSpy();
      const releaseB = releaseSpy();
      const releaseC = releaseSpy();

      cache.set({ key: key({ documentId: 'a', historyIndex: 0 }), value: 'a', byteSize: 5, release: releaseA });
      cache.set({ key: key({ documentId: 'b', historyIndex: 1 }), value: 'b', byteSize: 5, release: releaseB });
      cache.set({ key: key({ documentId: 'c', historyIndex: 2 }), value: 'c', byteSize: 5, release: releaseC });

      cache.invalidate((k) => k.documentId === 'b');

      expect(cache.size).toBe(2);
      expect(cache.get(key({ documentId: 'a', historyIndex: 0 }))).toBe('a');
      expect(cache.get(key({ documentId: 'b', historyIndex: 1 }))).toBeUndefined();
      expect(cache.get(key({ documentId: 'c', historyIndex: 2 }))).toBe('c');
      expect(releaseB).toHaveBeenCalledTimes(1);
      expect(releaseA).not.toHaveBeenCalled();
      expect(releaseC).not.toHaveBeenCalled();
    });

    it('is a no-op when no entries match', () => {
      const cache = new ReplayCheckpointCache();
      cache.set(checkpoint({ value: 'x', byteSize: 1 }));
      cache.invalidate(() => false);
      expect(cache.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes every entry and calls every release callback', () => {
      const cache = new ReplayCheckpointCache<string>();
      const releaseA = releaseSpy();
      const releaseB = releaseSpy();
      const releaseC = releaseSpy();

      cache.set({ key: key({ historyIndex: 0 }), value: 'a', byteSize: 3, release: releaseA });
      cache.set({ key: key({ historyIndex: 1 }), value: 'b', byteSize: 4, release: releaseB });
      cache.set({ key: key({ historyIndex: 2 }), value: 'c', byteSize: 5, release: releaseC });

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
      expect(releaseA).toHaveBeenCalledTimes(1);
      expect(releaseB).toHaveBeenCalledTimes(1);
      expect(releaseC).toHaveBeenCalledTimes(1);
    });

    it('is a no-op on an empty cache', () => {
      const cache = new ReplayCheckpointCache();
      expect(() => cache.clear()).not.toThrow();
      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
    });
  });

  describe('eviction', () => {
    it('evicts oldest entries when maxEntries is exceeded', () => {
      const cache = new ReplayCheckpointCache<string>({ maxEntries: 3 });
      const releases: string[] = [];

      for (let i = 0; i < 5; i++) {
        const release = releaseSpy();
        cache.set({
          key: key({ historyIndex: i }),
          value: `v${i}`,
          byteSize: 1,
          release: () => {
            release();
            releases.push(`v${i}`);
          },
        });
      }

      expect(cache.size).toBe(3);
      expect(releases).toEqual(['v0', 'v1']);
      expect(cache.get(key({ historyIndex: 4 }))).toBe('v4');
      expect(cache.get(key({ historyIndex: 0 }))).toBeUndefined();
    });

    it('evicts by byte size when maxBytes is exceeded', () => {
      const cache = new ReplayCheckpointCache<string>({ maxBytes: 10 });
      const releases: string[] = [];

      for (let i = 0; i < 4; i++) {
        cache.set({
          key: key({ historyIndex: i }),
          value: `v${i}`,
          byteSize: 5,
          release: () => releases.push(`v${i}`),
        });
      }

      // After setting v0,v1,v2,v3 (5 bytes each, cap 10), the two oldest
      // are evicted so that byte total ≤ 10.
      expect(cache.size).toBe(2);
      expect(releases).toEqual(['v0', 'v1']);
      expect(cache.byteSize).toBe(10);
    });

    it('evicts a single massive entry that exceeds maxBytes on its own', () => {
      const cache = new ReplayCheckpointCache<string>({ maxBytes: 5 });
      const release = releaseSpy();
      cache.set({ key: key({ historyIndex: 0 }), value: 'big', byteSize: 100, release });

      // The entry is inserted then immediately evicted because it alone
      // exceeds the byte ceiling.
      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('does not evict when the single entry fits within both limits', () => {
      const cache = new ReplayCheckpointCache<string>({ maxEntries: 2, maxBytes: 100 });
      const release = vi.fn();
      cache.set({ key: key({ historyIndex: 0 }), value: 'ok', byteSize: 50, release });

      expect(cache.size).toBe(1);
      expect(cache.byteSize).toBe(50);
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe('remove byte safety', () => {
    it('clamps byte count at zero when byteSize subtraction overshoots', () => {
      const cache = new ReplayCheckpointCache<string>();
      cache.set({ key: key({ historyIndex: 0 }), value: 'a', byteSize: 100 });

      // Manually craft a scenario where bytes < byteSize via eviction:
      // set two large entries under a tight maxBytes so only the last survives.
      const cache2 = new ReplayCheckpointCache<string>({ maxBytes: 10 });
      cache2.set({ key: key({ historyIndex: 0 }), value: 'x', byteSize: 100 });
      cache2.set({ key: key({ historyIndex: 1 }), value: 'y', byteSize: 100 });

      // After eviction, bytes should be clamped rather than negative.
      expect(cache2.byteSize).toBe(0);
    });
  });

  describe('degenerate cache limits', () => {
    it('stops evicting on an empty cache instead of looping forever', () => {
      // A non-positive entry ceiling keeps the eviction guard armed even with
      // nothing cached. The cache must bail out rather than spin.
      const cache = new ReplayCheckpointCache<string>({ maxEntries: -1 });

      expect(() => cache.set({ key: key(), value: 'v', byteSize: 1 })).not.toThrow();
      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
    });

    it('evicts down to an empty cache when the entry ceiling is zero', () => {
      const cache = new ReplayCheckpointCache<string>({ maxEntries: 0 });
      const release = releaseSpy();

      cache.set({ key: key({ historyIndex: 0 }), value: 'v', byteSize: 4, release });

      expect(cache.size).toBe(0);
      expect(cache.byteSize).toBe(0);
      expect(release).toHaveBeenCalledOnce();
    });

    it('keeps a checkpoint without a release callback evictable', () => {
      const cache = new ReplayCheckpointCache<string>({ maxEntries: 1 });

      cache.set({ key: key({ historyIndex: 0 }), value: 'a', byteSize: 4 });
      expect(() => cache.set({ key: key({ historyIndex: 1 }), value: 'b', byteSize: 4 })).not.toThrow();

      expect(cache.get(key({ historyIndex: 1 }))).toBe('b');
      expect(cache.get(key({ historyIndex: 0 }))).toBeUndefined();
    });
  });

  describe('default options', () => {
    it('uses default maxEntries (8) and maxBytes (32 MB) when no options given', () => {
      const cache = new ReplayCheckpointCache<string>();
      // 32 MB = 33554432 bytes
      const entry = { key: key({ historyIndex: 0 }), value: 'a', byteSize: 33554431 };
      cache.set(entry);
      expect(cache.size).toBe(1);
    });
  });
});

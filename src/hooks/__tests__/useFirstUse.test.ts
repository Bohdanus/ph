import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isToolNew, markToolAsSeen, isUnimplementedTool, useFirstUse } from '../useFirstUse.ts';

const STORAGE_KEY = 'ph.firstUse';

describe('first-use tool markers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('isUnimplementedTool', () => {
    it('returns true for unimplemented tools', () => {
      expect(isUnimplementedTool('pen')).toBe(true);
      expect(isUnimplementedTool('custom-shape')).toBe(true);
    });

    it('returns false for implemented tools', () => {
      expect(isUnimplementedTool('brush')).toBe(false);
      expect(isUnimplementedTool('hand')).toBe(false);
    });
  });

  describe('marker persistence', () => {
    it('marks unimplemented tools as new until they are seen', () => {
      expect(isToolNew('pen')).toBe(true);

      markToolAsSeen('pen');

      expect(isToolNew('pen')).toBe(false);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').pen).toBe(false);
    });

    it('is a no-op for implemented tools', () => {
      markToolAsSeen('brush');

      expect(isToolNew('brush')).toBe(false);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').brush).toBeUndefined();
    });

    it('handles localStorage read errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      expect(isToolNew('pen')).toBe(true);
    });

    it('handles localStorage write errors gracefully', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      expect(() => markToolAsSeen('pen')).not.toThrow();
      expect(isToolNew('pen')).toBe(true);
    });
  });

  describe('useFirstUse', () => {
    it('invalidates the consuming component after marking a tool as seen', () => {
      const { result } = renderHook(() => useFirstUse());
      expect(result.current.isToolNew('pen')).toBe(true);

      act(() => result.current.markToolAsSeen('pen'));

      expect(result.current.isToolNew('pen')).toBe(false);
    });

    it('updates after another tab writes the first-use record', () => {
      const { result } = renderHook(() => useFirstUse());
      expect(result.current.isToolNew('pen')).toBe(true);

      markToolAsSeen('pen');
      act(() => window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY })));

      expect(result.current.isToolNew('pen')).toBe(false);
    });

    it('ignores storage events for unrelated keys', () => {
      const { result } = renderHook(() => useFirstUse());

      act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'some-other-key' })));

      expect(result.current.isToolNew('pen')).toBe(true);
    });

    it('removes the storage listener on unmount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { unmount } = renderHook(() => useFirstUse());
      const storageHandler = addSpy.mock.calls.find(([type]) => type === 'storage')?.[1];

      expect(storageHandler).toBeDefined();
      unmount();

      expect(removeSpy).toHaveBeenCalledWith('storage', storageHandler);
    });

    it('keeps a failed storage write marked as new', () => {
      const { result } = renderHook(() => useFirstUse());
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      act(() => result.current.markToolAsSeen('pen'));

      expect(result.current.isToolNew('pen')).toBe(true);
    });
  });
});

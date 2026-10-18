import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isToolNew, markToolAsSeen, getUnintroducedTools, isUnimplementedTool, useFirstUse } from '../useFirstUse.ts';

describe('useFirstUse', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
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

  describe('isToolNew', () => {
    it('returns true for unimplemented tools that have not been seen', () => {
      expect(isToolNew('pen')).toBe(true);
    });

    it('returns false for unimplemented tools that have been marked as seen', () => {
      markToolAsSeen('pen');
      expect(isToolNew('pen')).toBe(false);
    });

    it('returns false for implemented tools regardless of storage', () => {
      expect(isToolNew('brush')).toBe(false);
    });
  });

  describe('markToolAsSeen', () => {
    it('marks an unimplemented tool as seen in localStorage', () => {
      markToolAsSeen('pen');
      const record = JSON.parse(localStorage.getItem('ph.firstUse') ?? '{}');
      expect(record.pen).toBe(false);
    });

    it('is a no-op for implemented tools', () => {
      markToolAsSeen('brush');
      const record = JSON.parse(localStorage.getItem('ph.firstUse') ?? '{}');
      expect(record.brush).toBeUndefined();
    });

    it('is safe to call on a tool already marked as seen', () => {
      markToolAsSeen('pen');
      markToolAsSeen('pen');
      const record = JSON.parse(localStorage.getItem('ph.firstUse') ?? '{}');
      expect(record.pen).toBe(false);
    });
  });

  describe('getUnintroducedTools', () => {
    it('returns all unimplemented tools on first run', () => {
      const tools = getUnintroducedTools();
      expect(tools).toContain('pen');
      expect(tools).toContain('custom-shape');
      expect(tools).toContain('freeform-pen');
      expect(tools).toContain('curvature-pen');
      expect(tools).toContain('add-anchor-point');
      expect(tools).toContain('delete-anchor-point');
      expect(tools).toContain('convert-point');
      expect(tools).toHaveLength(7);
    });

    it('excludes tools that have been marked as seen', () => {
      markToolAsSeen('pen');
      const tools = getUnintroducedTools();
      expect(tools).not.toContain('pen');
      expect(tools).toHaveLength(6);
    });

    it('returns an empty array when all unimplemented tools have been seen', () => {
      const unimplemented = getUnintroducedTools();
      for (const tool of unimplemented) {
        markToolAsSeen(tool);
      }
      expect(getUnintroducedTools()).toHaveLength(0);
    });
  });

  describe('useFirstUse hook', () => {
    it('returns true for a new unimplemented tool on first render', () => {
      const { result } = renderHook(() => useFirstUse('pen'));
      expect(result.current[0]).toBe(true);
    });

    it('returns false for an implemented tool', () => {
      const { result } = renderHook(() => useFirstUse('brush'));
      expect(result.current[0]).toBe(false);
    });

    it('returns false after markSeen is called', () => {
      const { result } = renderHook(() => useFirstUse('pen'));
      expect(result.current[0]).toBe(true);

      act(() => {
        result.current[1]();
      });

      expect(result.current[0]).toBe(false);
      expect(isToolNew('pen')).toBe(false);
    });

    it('does not call markToolAsSeen when the tool is already not new', () => {
      const { result } = renderHook(() => useFirstUse('brush'));
      const markSpy = vi.spyOn(Storage.prototype, 'setItem');

      act(() => {
        result.current[1]();
      });

      expect(markSpy).not.toHaveBeenCalled();
      markSpy.mockRestore();
    });

    it('updates when another tab marks the tool as seen via a storage event', () => {
      const { result } = renderHook(() => useFirstUse('pen'));
      expect(result.current[0]).toBe(true);

      // Simulate another tab writing the seen flag to localStorage
      markToolAsSeen('pen');

      act(() => {
        const event = new StorageEvent('storage', { key: 'ph.firstUse' });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe(false);
    });

    it('ignores storage events for other keys', () => {
      markToolAsSeen('pen');
      const { result } = renderHook(() => useFirstUse('custom-shape'));
      expect(result.current[0]).toBe(true);

      act(() => {
        const event = new StorageEvent('storage', { key: 'some-other-key' });
        window.dispatchEvent(event);
      });

      expect(result.current[0]).toBe(true);
    });

    it('handles localStorage read errors gracefully', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem');
      spy.mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      const { result } = renderHook(() => useFirstUse('pen'));
      // When storage fails, isToolNew catches the error and returns based on the
      // try/catch in readRecord, which returns {} — meaning the tool IS new.
      expect(result.current[0]).toBe(true);

      spy.mockRestore();
    });

    it('handles localStorage write errors gracefully', () => {
      const { result } = renderHook(() => useFirstUse('pen'));

      const setSpy = vi.spyOn(Storage.prototype, 'setItem');
      setSpy.mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      act(() => {
        result.current[1]();
      });

      // markSeen calls setIsNew(false) even if writeRecord throws — the error is caught.
      // But since setItem throws, the write fails and readRecord returns {} on the next read.
      // The state update to false still happens.
      expect(result.current[0]).toBe(false);

      setSpy.mockRestore();
    });
  });
});

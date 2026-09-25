import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentToolProvider, useCurrentTool } from '../useCurrentTool.tsx';
import type { ToolArgs, ToolName } from '../tool-types.ts';
import { lastSavedSettings } from '../../tools/settings.ts';

const storeState = vi.hoisted(
  (): {
    toolName: ToolName;
    isToolDirty: boolean;
    currentArgs: React.RefObject<ToolArgs>;
  } => ({
    toolName: 'draw',
    isToolDirty: false,
    currentArgs: { current: {} as ToolArgs },
  })
);

vi.mock('../StoreContext.tsx', () => ({
  useStore: () => [
    {
      toolName: storeState.toolName,
      isToolDirty: storeState.isToolDirty,
      currentArgs: storeState.currentArgs,
    },
    vi.fn(),
  ],
}));

function renderCurrentTool() {
  return renderHook(() => useCurrentTool(), {
    wrapper: ({ children }) => <CurrentToolProvider>{children}</CurrentToolProvider>,
  });
}

describe('useCurrentTool', () => {
  beforeEach(() => {
    storeState.toolName = 'draw';
    storeState.isToolDirty = false;
    storeState.currentArgs = { current: {} as ToolArgs };

    // Reset saved settings to defaults to avoid cross-test pollution.
    lastSavedSettings.draw = {
      alpha: 0.9,
      lineWidth: 10,
      color: '#000000',
      points: [],
      penType: 'pen',
      toolName: 'draw',
    };
    lastSavedSettings.blur = { radius: 0, toolName: 'blur' };
    lastSavedSettings.levels = { brightness: 0, contrast: 0, toolName: 'levels' };
    lastSavedSettings.rectangle = {
      alpha: 1,
      lineWidth: 5,
      cornerRadius: 0,
      toolMode: 'shape',
      figure: 'rectangle',
      color: '#000000',
      backgroundColor: null,
      toolName: 'rectangle',
    };
  });

  describe('error boundary', () => {
    it('throws when used outside a CurrentToolProvider', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => renderHook(() => useCurrentTool())).toThrow(
        'useCurrentTool must be used within a CurrentToolProvider'
      );
      spy.mockRestore();
    });
  });

  describe('initialization', () => {
    it('initializes toolArgs from saved settings for the current tool', () => {
      const { result } = renderCurrentTool();
      expect(result.current.toolArgs.toolName).toBe('draw');
      expect(result.current.toolArgs).toMatchObject(lastSavedSettings.draw);
    });

    it('exposes isToolDirty from the store', () => {
      storeState.isToolDirty = true;
      const { result } = renderCurrentTool();
      expect(result.current.isToolDirty).toBe(true);
    });
  });

  describe('tool switching', () => {
    it('returns saved args for a different tool when the internal state lags', () => {
      storeState.toolName = 'blur';
      const { result } = renderCurrentTool();
      expect(result.current.toolArgs.toolName).toBe('blur');
      expect(result.current.toolArgs).toMatchObject(lastSavedSettings.blur);
    });

    it('returns internal args once they are set for the active tool', () => {
      storeState.toolName = 'blur';
      const { result } = renderCurrentTool();

      act(() => {
        result.current.setToolArgs({ toolName: 'blur', radius: 99 });
      });

      expect(result.current.toolArgs).toMatchObject({ toolName: 'blur', radius: 99 });
    });
  });

  describe('setToolArgs', () => {
    it('persists settings via saveLastSettings and updates state', () => {
      const { result } = renderCurrentTool();
      const originalDraw = lastSavedSettings.draw;

      act(() => {
        result.current.setToolArgs({
          toolName: 'draw',
          color: '#ff0000',
          alpha: 0.5,
          lineWidth: 42,
          penType: 'pen',
          points: [],
        });
      });

      // Internal state was updated.
      expect(result.current.toolArgs).toMatchObject({
        toolName: 'draw',
        color: '#ff0000',
        alpha: 0.5,
      });

      // saveLastSettings normalizes draw args (strips points to []).
      expect(lastSavedSettings.draw).toMatchObject({ color: '#ff0000', points: [] });
      expect(lastSavedSettings.draw).not.toBe(originalDraw);
    });
  });

  describe('getToolArgs', () => {
    it('returns the typed args when the tool name matches', () => {
      storeState.toolName = 'blur';
      const { result } = renderCurrentTool();

      const args = result.current.getToolArgs('blur');
      expect(args).not.toBeNull();
      expect(args?.toolName).toBe('blur');
    });

    it('returns null when the tool name does not match', () => {
      storeState.toolName = 'draw';
      const { result } = renderCurrentTool();

      expect(result.current.getToolArgs('blur')).toBeNull();
    });
  });

  describe('patchToolArgs', () => {
    it('patches the existing args when the tool name matches', () => {
      storeState.toolName = 'blur';
      const { result } = renderCurrentTool();

      act(() => {
        result.current.patchToolArgs('blur', { radius: 77 });
      });

      expect(result.current.toolArgs).toMatchObject({ toolName: 'blur', radius: 77 });
    });

    it('falls back to saved args when the tool name does not match', () => {
      storeState.toolName = 'blur';
      const { result, rerender } = renderCurrentTool();

      // Patch a different tool — should load its saved args then apply the patch.
      act(() => {
        result.current.patchToolArgs('rectangle', { lineWidth: 77 });
      });

      // The patch is persisted to saved settings via saveLastSettings (rectangle is handled).
      expect(lastSavedSettings.rectangle).toMatchObject({ lineWidth: 77 });

      // When the store switches to the patched tool, the internal state surfaces.
      storeState.toolName = 'rectangle';
      rerender();
      expect(result.current.toolArgs).toMatchObject({ toolName: 'rectangle', lineWidth: 77 });
    });

    it('persists the patched args through saveLastSettings', () => {
      storeState.toolName = 'rectangle';
      const { result, rerender } = renderCurrentTool();

      act(() => {
        result.current.patchToolArgs('rectangle', { lineWidth: 33 });
      });

      expect(lastSavedSettings.rectangle).toMatchObject({ lineWidth: 33 });
      // After re-render, the active tool should reflect the patch.
      rerender();
      expect(result.current.toolArgs).toMatchObject({ lineWidth: 33 });
    });
  });

  describe('resetToLastSavedArgs', () => {
    it('resets the internal state to saved args for the current tool', () => {
      storeState.toolName = 'blur';
      const { result } = renderCurrentTool();

      act(() => {
        result.current.setToolArgs({ toolName: 'blur', radius: 999 });
      });
      expect(result.current.toolArgs).toMatchObject({ radius: 999 });

      act(() => {
        result.current.resetToLastSavedArgs();
      });

      expect(result.current.toolArgs).toMatchObject(lastSavedSettings.blur);
    });

    it('can reset to a different tool explicitly', () => {
      storeState.toolName = 'blur';
      const { result, rerender } = renderCurrentTool();

      act(() => {
        result.current.resetToLastSavedArgs('levels');
      });

      // The internal state now tracks 'levels'; switch the store to surface it.
      storeState.toolName = 'levels';
      rerender();
      expect(result.current.toolArgs).toMatchObject(lastSavedSettings.levels);
    });
  });

  describe('currentArgsRef sync', () => {
    it('syncs the store currentArgs ref with the latest toolArgs', () => {
      const { result } = renderCurrentTool();

      act(() => {
        result.current.setToolArgs({
          toolName: 'draw',
          color: '#abcdef',
          alpha: 1,
          lineWidth: 2,
          penType: 'pen',
          points: [],
        });
      });

      expect(storeState.currentArgs.current).toEqual(result.current.toolArgs);
    });

    it('keeps currentArgs ref in sync after a tool switch', () => {
      storeState.toolName = 'draw';
      const { rerender } = renderCurrentTool();

      storeState.toolName = 'blur';
      rerender();

      expect(storeState.currentArgs.current.toolName).toBe('blur');
    });
  });
});

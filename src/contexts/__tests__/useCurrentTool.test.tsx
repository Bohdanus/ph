import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolArgs } from '../tool-types.ts';
import { CurrentToolProvider, useCurrentTool } from '../useCurrentTool.tsx';
import { StoreProvider, useStore } from '../StoreContext.tsx';

const { lastSavedSettings, seedDrawSettings, seedShapeSettings, seedTextSettings } = vi.hoisted(() => {
  const makeSeedDrawSettings = () => ({
    toolName: 'draw',
    penType: 'pen',
    lineWidth: 5,
    alpha: 1,
    color: '#000000',
    lineDash: null,
  });

  const makeSeedShapeSettings = () => ({
    toolName: 'shape',
    figure: 'rectangle',
    alpha: 1,
    color: '#000000',
    backgroundColor: '#ffffff',
    hasFill: false,
    lineWidth: 5,
    lineDash: null,
  });

  const makeSeedTextSettings = () => ({
    toolName: 'text',
    text: 'Hello',
    fontSize: 64,
    lineHeight: 1.1,
    rect: null,
    bold: false,
    italic: false,
    fontFamily: 'Arial',
    align: 'left',
  });

  return {
    seedDrawSettings: makeSeedDrawSettings,
    seedShapeSettings: makeSeedShapeSettings,
    seedTextSettings: makeSeedTextSettings,
    lastSavedSettings: {
      draw: makeSeedDrawSettings(),
      shape: makeSeedShapeSettings(),
      text: makeSeedTextSettings(),
    },
  };
});

const { saveLastSettingsMock } = vi.hoisted(() => ({ saveLastSettingsMock: vi.fn() }));

vi.mock('../../tools/settings.ts', () => ({ lastSavedSettings }));

vi.mock('../../util/settings.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/settings.ts')>();
  return {
    ...actual,
    // Record the raw commit and then delegate to the real persistence layer, so the
    // spy still proves what the provider passed while the settings store receives it.
    saveLastSettings: (args: ToolArgs) => {
      saveLastSettingsMock(args);
      return actual.saveLastSettings(args);
    },
  };
});

const shapeArgs = {
  toolName: 'shape',
  alpha: 1,
  color: '#000000',
  backgroundColor: '#ffffff',
  hasFill: false,
  lineWidth: 5,
  lineDash: null,
} as const;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <CurrentToolProvider>{children}</CurrentToolProvider>
    </StoreProvider>
  );
}

function renderWithProviders() {
  return renderHook(() => useCurrentTool(), { wrapper });
}

function renderWithStore() {
  return renderHook(() => ({ tool: useCurrentTool(), store: useStore() }), { wrapper });
}

/**
 * `CurrentToolProvider` only exposes args for the tool the store currently has
 * selected, so shape assertions must select `shape` in the store first.
 */
function renderForShape() {
  const rendered = renderWithStore();
  act(() => {
    rendered.result.current.store[1]({ type: 'SET_TOOL_NAME', payload: 'shape' });
  });
  return rendered;
}

describe('useCurrentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `lastSavedSettings` is mutable module state that the real `saveLastSettings`
    // now writes into, so restore every seed before each test instead of trusting
    // test order.
    lastSavedSettings.draw = seedDrawSettings();
    lastSavedSettings.shape = seedShapeSettings();
    lastSavedSettings.text = seedTextSettings();
  });

  it('throws when used outside CurrentToolProvider', () => {
    expect(() => renderHook(() => useCurrentTool())).toThrow(
      'useCurrentTool must be used within a CurrentToolProvider'
    );
  });

  it('returns initial toolArgs from lastSavedSettings', () => {
    const { result } = renderWithProviders();
    expect(result.current.toolArgs.toolName).toBe('draw');
    expect(result.current.getToolArgs('draw')).toMatchObject({ penType: 'pen', lineWidth: 5 });
  });

  describe('setToolArgs', () => {
    it('updates toolArgs and marks tool as dirty', () => {
      const { result } = renderWithProviders();
      const newArgs: ToolArgs = {
        toolName: 'draw',
        penType: 'spray',
        lineWidth: 10,
        alpha: 0.5,
        color: '#ff0000',
        lineDash: null,
      };

      act(() => {
        result.current.setToolArgs(newArgs);
      });

      expect(result.current.toolArgs).toEqual(newArgs);
    });

    it('calls saveLastSettings with new args', () => {
      const { result } = renderWithProviders();
      const newArgs: ToolArgs = {
        toolName: 'draw',
        penType: 'spray',
        lineWidth: 10,
        alpha: 0.5,
        color: '#ff0000',
        lineDash: null,
      };

      act(() => {
        result.current.setToolArgs(newArgs);
      });

      expect(saveLastSettingsMock).toHaveBeenCalledWith(newArgs);
    });

    it('persists the normalized figure instead of the legacy one', () => {
      const { result } = renderForShape();
      const legacyArgs = { ...shapeArgs, figure: 'circle' as unknown as 'oval' } as ToolArgs;

      act(() => {
        result.current.tool.setToolArgs(legacyArgs);
      });

      expect(saveLastSettingsMock).toHaveBeenCalledWith({ ...legacyArgs, figure: 'oval' });
      expect(saveLastSettingsMock).not.toHaveBeenCalledWith(expect.objectContaining({ figure: 'circle' }));
    });

    it('updates currentArgs ref in store', () => {
      const { result } = renderWithStore();
      const newArgs: ToolArgs = {
        toolName: 'draw',
        penType: 'spray',
        lineWidth: 10,
        alpha: 0.5,
        color: '#ff0000',
        lineDash: null,
      };

      act(() => {
        result.current.tool.setToolArgs(newArgs);
      });

      expect(result.current.store[0].currentArgs.current).toEqual(newArgs);
    });
  });

  describe('getToolArgs', () => {
    it('returns toolArgs when toolName matches', () => {
      const { result } = renderForShape();

      const args = result.current.tool.getToolArgs('shape');
      expect(args).not.toBeNull();
      expect(args?.toolName).toBe('shape');
    });

    it('returns null when toolName does not match', () => {
      const { result } = renderWithProviders();
      const args = result.current.getToolArgs('shape');
      expect(args).toBeNull();
    });

    it('returns typed args for the requested tool', () => {
      const { result } = renderForShape();

      act(() => {
        result.current.tool.setToolArgs({ ...shapeArgs, figure: 'oval' });
      });

      const shapeToolArgs = result.current.tool.getToolArgs('shape');
      expect(shapeToolArgs).not.toBeNull();
      expect(shapeToolArgs?.figure).toBe('oval');
    });
  });

  describe('patchToolArgs', () => {
    it('patches existing tool args when tool matches', () => {
      const { result } = renderForShape();
      act(() => {
        result.current.tool.setToolArgs({ ...shapeArgs, figure: 'rectangle' });
      });

      act(() => {
        result.current.tool.patchToolArgs('shape', { figure: 'oval', lineWidth: 10 });
      });

      expect(result.current.tool.getToolArgs('shape')).toMatchObject({
        figure: 'oval',
        lineWidth: 10,
        color: '#000000',
      });
    });

    it('creates new args from saved settings when tool does not match', () => {
      const { result } = renderWithProviders();
      act(() => {
        result.current.patchToolArgs('shape', { figure: 'oval' });
      });

      // The store still has `draw` selected, so the shape patch is staged but
      // not yet the active args.
      expect(result.current.getToolArgs('shape')).toBeNull();
      expect(result.current.toolArgs.toolName).toBe('draw');
      expect(result.current.getToolArgs('draw')?.lineWidth).toBe(5);
    });

    it('normalizes a legacy circle figure to oval instead of leaving it in state', () => {
      const { result } = renderForShape();

      act(() => {
        result.current.tool.patchToolArgs('shape', { figure: 'circle' as unknown as 'oval' });
      });

      expect(result.current.tool.getToolArgs('shape')?.figure).toBe('oval');
    });

    it('normalizes a legacy square figure to rectangle instead of leaving it in state', () => {
      const { result } = renderForShape();

      act(() => {
        result.current.tool.patchToolArgs('shape', { figure: 'square' as unknown as 'rectangle' });
      });

      expect(result.current.tool.getToolArgs('shape')?.figure).toBe('rectangle');
    });

    it('normalizes a legacy figure coming from already-corrupted saved settings', () => {
      lastSavedSettings.shape = { ...lastSavedSettings.shape, figure: 'circle' } as typeof lastSavedSettings.shape;

      const { result } = renderForShape();
      act(() => {
        result.current.tool.patchToolArgs('shape', { lineWidth: 3 });
      });

      expect(result.current.tool.getToolArgs('shape')).toMatchObject({ figure: 'oval', lineWidth: 3 });
    });
  });

  describe('tool switching', () => {
    it('loads saved settings when tool changes via store', () => {
      const { result } = renderWithStore();

      expect(result.current.tool.toolArgs.toolName).toBe('draw');

      act(() => {
        result.current.store[1]({ type: 'SET_TOOL_NAME', payload: 'shape' });
      });

      expect(result.current.store[0].toolName).toBe('shape');
      expect(result.current.tool.getToolArgs('shape')).toMatchObject({ figure: 'rectangle' });
    });
  });
});

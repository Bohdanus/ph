import { act, renderHook } from '@testing-library/react';
import { cloneDeep } from 'lodash-es';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultSettings, lastSavedSettings } from '../../tools/settings.ts';
import type { FigureType, ShapeToolArgs } from '../../tools/shape.ts';
import type { ToolArgs, ToolArgsByName, ToolName } from '../tool-types.ts';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import { CurrentToolProvider, useCurrentTool } from '../useCurrentTool.tsx';

const { saveLastSettingsSpy } = vi.hoisted(() => ({ saveLastSettingsSpy: vi.fn() }));

vi.mock('../../tools/settings.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tools/settings.ts')>();
  // `lastSavedSettings` is mutable module state, so hand the mocked module an
  // empty object and seed a pristine copy from the real defaults per test.
  return { ...actual, lastSavedSettings: {} as typeof actual.lastSavedSettings };
});

vi.mock('../../util/settings.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../util/settings.ts')>();
  return {
    ...actual,
    // Record every write and then delegate to the real persistence layer. The
    // spy is what proves the provider normalized the figure itself, because the
    // persistence layer normalizes again on its own.
    saveLastSettings: (args: ToolArgs) => {
      saveLastSettingsSpy(args);
      return actual.saveLastSettings(args);
    },
  };
});

const validFigures: FigureType[] = ['line', 'rectangle', 'oval', 'triangle', 'polygon'];
const garbageFigures: unknown[] = ['blob', '', 42, null, undefined, 'CIRCLE', 'Circle'];
const nonShapeTools: ToolName[] = ['draw', 'text', 'rectangular-selection'];

/** Saved shape settings carrying a distinctive style and a `figure` to coerce. */
const shapeSettingsWith = (figure: unknown): ToolArgsByName['shape'] =>
  ({
    ...(cloneDeep(defaultSettings.shape) as ShapeToolArgs),
    alpha: 0.25,
    color: '#123456',
    backgroundColor: '#ffffff',
    hasFill: true,
    lineWidth: 7,
    lineDash: [4, 2],
    cornerRadius: 4,
    lineCap: 'round',
    figure,
  }) as unknown as ToolArgsByName['shape'];

/** Committed shape args, i.e. what a tool hands to `setToolArgs`. */
const shapeArgsWith = (figure: unknown): ToolArgs =>
  ({
    toolName: 'shape',
    alpha: 0.25,
    color: '#123456',
    backgroundColor: '#ffffff',
    hasFill: true,
    lineWidth: 7,
    lineDash: [4, 2],
    cornerRadius: 4,
    lineCap: 'round',
    toolMode: 'shape',
    figure,
  }) as unknown as ToolArgs;

const textArgs: ToolArgs = {
  toolName: 'text',
  text: 'abc',
  fontSize: 12,
  lineHeight: 1.2,
  fontFamily: 'Arial',
  color: '#000000',
  rect: null,
  align: 'left',
  bold: false,
  italic: false,
};

type Harness = ReturnType<typeof renderHarness>;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <CurrentToolProvider>{children}</CurrentToolProvider>
    </StoreProvider>
  );
}

function renderHarness() {
  return renderHook(() => ({ tool: useCurrentTool(), store: useStore() }), { wrapper });
}

function selectTool(rendered: Harness, toolName: ToolName) {
  act(() => {
    rendered.result.current.store[1]({ type: 'SET_TOOL_NAME', payload: toolName });
  });
}

const refArgs = (rendered: Harness): ShapeToolArgs =>
  rendered.result.current.store[0].currentArgs.current as ShapeToolArgs;
const stateArgs = (rendered: Harness): ShapeToolArgs => rendered.result.current.tool.toolArgs as ShapeToolArgs;
const savedShapeFigure = (): unknown => (lastSavedSettings.shape as { figure?: unknown }).figure;
const firstPersistedArgs = (): ToolArgs => saveLastSettingsSpy.mock.calls[0][0] as ToolArgs;

describe('useCurrentTool legacy figure boundary', () => {
  let baseline: ToolArgsByName;

  beforeEach(() => {
    saveLastSettingsSpy.mockClear();
    Object.assign(lastSavedSettings, cloneDeep(defaultSettings));
    baseline = cloneDeep(defaultSettings);
  });

  afterEach(() => {
    saveLastSettingsSpy.mockClear();
    Object.assign(lastSavedSettings, cloneDeep(defaultSettings));
  });

  describe('read path: lastSavedSettings -> provider', () => {
    it('coerces a persisted legacy circle figure to oval when the shape tool is selected', () => {
      lastSavedSettings.shape = shapeSettingsWith('circle');

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      const args = rendered.result.current.tool.getToolArgs('shape');
      expect(args?.figure).toBe('oval');
      // The saved style must survive the coercion untouched.
      expect(args).toMatchObject({
        toolName: 'shape',
        alpha: 0.25,
        color: '#123456',
        backgroundColor: '#ffffff',
        hasFill: true,
        lineWidth: 7,
        lineDash: [4, 2],
        cornerRadius: 4,
        lineCap: 'round',
        toolMode: 'shape',
      });
    });

    it('coerces a persisted legacy square figure to rectangle when the shape tool is selected', () => {
      lastSavedSettings.shape = shapeSettingsWith('square');

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      const args = rendered.result.current.tool.getToolArgs('shape');
      expect(args?.figure).toBe('rectangle');
      expect(args).toMatchObject({ lineWidth: 7, cornerRadius: 4, hasFill: true });
    });

    it('coerces the legacy figure when resetting the shape tool back to saved settings', () => {
      lastSavedSettings.shape = shapeSettingsWith('circle');

      const rendered = renderHarness();
      selectTool(rendered, 'shape');
      act(() => {
        rendered.result.current.tool.setToolArgs({ ...(shapeArgsWith('polygon') as ShapeToolArgs), lineWidth: 99 });
      });
      expect(stateArgs(rendered).figure).toBe('polygon');
      // The commit above persisted `polygon`, so restore the legacy value to
      // model a document that was saved by an older build.
      lastSavedSettings.shape = shapeSettingsWith('circle');

      act(() => {
        rendered.result.current.tool.resetToLastSavedArgs('shape');
      });

      expect(stateArgs(rendered).figure).toBe('oval');
      expect(stateArgs(rendered).lineWidth).toBe(7);
    });

    it.each(validFigures)('publishes the already valid saved figure %s unchanged', (figure) => {
      lastSavedSettings.shape = shapeSettingsWith(figure);

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      expect(rendered.result.current.tool.getToolArgs('shape')).toEqual(shapeSettingsWith(figure));
    });

    it('hands out a deep copy of the saved settings instead of the stored object', () => {
      lastSavedSettings.shape = shapeSettingsWith('oval');

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      const args = rendered.result.current.tool.getToolArgs('shape') as ShapeToolArgs;
      expect(args).toEqual(lastSavedSettings.shape);
      expect(args).not.toBe(lastSavedSettings.shape);

      // Mutating the published args must not write through into the settings.
      (args as { lineWidth: number }).lineWidth = 999;
      expect((lastSavedSettings.shape as ShapeToolArgs).lineWidth).toBe(7);

      act(() => {
        rendered.result.current.tool.resetToLastSavedArgs('shape');
      });
      expect(stateArgs(rendered).lineWidth).toBe(7);
    });

    it.each(garbageFigures)('falls back to rectangle for the unknown saved figure %s', (figure) => {
      lastSavedSettings.shape = shapeSettingsWith(figure);

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      const args = rendered.result.current.tool.getToolArgs('shape');
      expect(args?.figure).toBe('rectangle');
      expect(args?.toolName).toBe('shape');
      expect(args?.lineWidth).toBe(7);
    });

    it('leaves saved shape settings that carry no figure key alone', () => {
      const withoutFigure = { ...shapeSettingsWith('oval') } as Record<string, unknown>;
      delete withoutFigure.figure;
      lastSavedSettings.shape = withoutFigure as unknown as ToolArgsByName['shape'];

      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      const args = rendered.result.current.tool.getToolArgs('shape');
      expect(args).toEqual(withoutFigure);
      expect('figure' in (args as object)).toBe(false);
    });

    it('coerces a legacy figure persisted under the dedicated ellipse tool settings', () => {
      lastSavedSettings.ellipse = {
        ...(cloneDeep(defaultSettings.ellipse) as ToolArgsByName['ellipse']),
        lineWidth: 12,
        figure: 'circle' as unknown as 'oval',
      };

      const rendered = renderHarness();
      selectTool(rendered, 'ellipse');

      const args = rendered.result.current.tool.getToolArgs('ellipse');
      expect(args?.figure).toBe('oval');
      expect(args).toMatchObject({ toolName: 'ellipse', lineWidth: 12 });
    });

    it('coerces a legacy figure persisted under the dedicated rectangle tool settings', () => {
      lastSavedSettings.rectangle = {
        ...(cloneDeep(defaultSettings.rectangle) as ToolArgsByName['rectangle']),
        cornerRadius: 6,
        figure: 'square' as unknown as 'rectangle',
      };

      const rendered = renderHarness();
      selectTool(rendered, 'rectangle');

      const args = rendered.result.current.tool.getToolArgs('rectangle');
      expect(args?.figure).toBe('rectangle');
      expect(args).toMatchObject({ toolName: 'rectangle', cornerRadius: 6 });
    });

    it.each(nonShapeTools)('leaves the saved %s args completely unaffected', (toolName) => {
      lastSavedSettings.draw = { ...(cloneDeep(baseline.draw) as ToolArgsByName['draw']), lineWidth: 13 };
      lastSavedSettings.text = { ...(cloneDeep(baseline.text) as ToolArgsByName['text']), fontSize: 21 };
      lastSavedSettings['rectangular-selection'] = { toolName: 'rectangular-selection' };

      const rendered = renderHarness();
      selectTool(rendered, toolName);

      const args = rendered.result.current.tool.getToolArgs(toolName);
      expect(args).toEqual(lastSavedSettings[toolName]);
      expect(args).not.toBe(lastSavedSettings[toolName]);
      expect('figure' in (args as object)).toBe(false);
      expect(Object.keys(args as object)).not.toContain('figure');
      expect(rendered.result.current.tool.getToolArgs('shape')).toBeNull();
    });

    it('normalizes a legacy saved figure before a patch is merged onto it', () => {
      lastSavedSettings.shape = shapeSettingsWith('circle');

      const rendered = renderHarness();
      act(() => {
        rendered.result.current.tool.patchToolArgs('shape', { lineWidth: 3 });
      });

      // The patch is staged for a tool the store has not selected yet, but it
      // still commits the normalized base to the settings sink.
      expect(rendered.result.current.tool.getToolArgs('shape')).toBeNull();
      expect(rendered.result.current.tool.toolArgs.toolName).toBe('draw');
      expect(firstPersistedArgs()).toMatchObject({ figure: 'oval', lineWidth: 3, color: '#123456' });
      expect(savedShapeFigure()).toBe('oval');
    });
  });

  describe('write path: provider -> ref, settings and React state', () => {
    it('publishes the normalized circle figure to the ref, the settings sink and React state', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      act(() => {
        rendered.result.current.tool.setToolArgs(shapeArgsWith('circle'));
      });

      expect(refArgs(rendered)).toMatchObject({ figure: 'oval', lineWidth: 7, toolName: 'shape' });
      expect(saveLastSettingsSpy).toHaveBeenCalledTimes(1);
      expect(firstPersistedArgs()).toMatchObject({ figure: 'oval', lineWidth: 7, toolName: 'shape' });
      expect(savedShapeFigure()).toBe('oval');
      expect(stateArgs(rendered)).toMatchObject({ figure: 'oval', lineWidth: 7, toolName: 'shape' });
    });

    it('publishes the normalized square figure to the ref, the settings sink and React state', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      act(() => {
        rendered.result.current.tool.setToolArgs(shapeArgsWith('square'));
      });

      expect(refArgs(rendered)).toMatchObject({ figure: 'rectangle', toolName: 'shape' });
      expect(firstPersistedArgs()).toMatchObject({ figure: 'rectangle', toolName: 'shape' });
      expect(savedShapeFigure()).toBe('rectangle');
      expect(stateArgs(rendered)).toMatchObject({ figure: 'rectangle', toolName: 'shape' });
    });

    it('persists the normalized figure so a remount cannot resurrect the legacy value', () => {
      lastSavedSettings.shape = shapeSettingsWith('square');

      const first = renderHarness();
      selectTool(first, 'shape');
      act(() => {
        first.result.current.tool.setToolArgs({ ...(shapeArgsWith('square') as ShapeToolArgs), lineWidth: 11 });
      });
      first.unmount();

      expect(savedShapeFigure()).toBe('rectangle');
      expect(JSON.stringify(lastSavedSettings)).not.toContain('"square"');

      const second = renderHarness();
      selectTool(second, 'shape');
      expect(stateArgs(second)).toMatchObject({ figure: 'rectangle', lineWidth: 11 });
    });

    it('normalizes a legacy figure supplied to patchToolArgs in all three sinks', () => {
      lastSavedSettings.shape = shapeSettingsWith('rectangle');

      const rendered = renderHarness();
      selectTool(rendered, 'shape');
      act(() => {
        rendered.result.current.tool.patchToolArgs('shape', { figure: 'circle' as unknown as 'oval' });
      });

      expect(refArgs(rendered).figure).toBe('oval');
      expect(firstPersistedArgs()).toMatchObject({ figure: 'oval', toolName: 'shape' });
      expect(savedShapeFigure()).toBe('oval');
      expect(rendered.result.current.tool.getToolArgs('shape')?.figure).toBe('oval');
    });

    it('keeps the caller-supplied args object untouched', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'shape');
      const committed = shapeArgsWith('circle');

      act(() => {
        rendered.result.current.tool.setToolArgs(committed);
      });

      expect((committed as unknown as ShapeToolArgs).figure).toBe('circle');
      expect(stateArgs(rendered)).not.toBe(committed);
      expect(refArgs(rendered)).not.toBe(committed);
      expect(stateArgs(rendered)).toEqual({ ...(committed as unknown as ShapeToolArgs), figure: 'oval' });
    });

    it('stages the ref and the React state in one transition with the same normalized args', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'shape');

      let figureSeenInRefDuringCommit: unknown = 'never-read';
      act(() => {
        rendered.result.current.tool.setToolArgs(shapeArgsWith('circle'));
        figureSeenInRefDuringCommit = refArgs(rendered).figure;
      });

      expect(figureSeenInRefDuringCommit).toBe('oval');
      expect(refArgs(rendered)).toBe(stateArgs(rendered));
      expect(stateArgs(rendered).figure).toBe('oval');
    });

    it('stores args without a figure key unchanged, with no spurious figure key', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'text');

      act(() => {
        rendered.result.current.tool.setToolArgs(textArgs);
      });

      expect(stateArgs(rendered)).toEqual(textArgs);
      expect('figure' in stateArgs(rendered)).toBe(false);
      expect(Object.keys(stateArgs(rendered))).not.toContain('figure');
      expect(lastSavedSettings.text).toMatchObject({ toolName: 'text', fontSize: 12 });
      expect(Object.keys(lastSavedSettings.text as object)).not.toContain('figure');
    });

    it('stores rectangular-selection args unchanged and persists only the tool name', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'rectangular-selection');
      const selectionArgs: ToolArgs = { toolName: 'rectangular-selection' };

      act(() => {
        rendered.result.current.tool.setToolArgs(selectionArgs);
      });

      expect(stateArgs(rendered)).toEqual(selectionArgs);
      expect('figure' in stateArgs(rendered)).toBe(false);
      expect(lastSavedSettings['rectangular-selection']).toEqual({ toolName: 'rectangular-selection' });
    });

    it.each(validFigures)('stores the already valid figure %s unchanged', (figure) => {
      const rendered = renderHarness();
      selectTool(rendered, 'shape');
      const committed = shapeArgsWith(figure);

      act(() => {
        rendered.result.current.tool.setToolArgs(committed);
      });

      expect(stateArgs(rendered).figure).toBe(figure);
      expect(refArgs(rendered).figure).toBe(figure);
      expect(savedShapeFigure()).toBe(figure);
      expect(stateArgs(rendered)).toEqual(committed as unknown as ShapeToolArgs);
    });

    it('does not throw or corrupt the settings for a tool the persistence layer ignores', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'blur');

      expect(() => {
        act(() => {
          rendered.result.current.tool.patchToolArgs('blur', { radius: 12 });
        });
      }).not.toThrow();

      expect(stateArgs(rendered)).toMatchObject({ toolName: 'blur', radius: 12 });
      expect(refArgs(rendered)).toMatchObject({ toolName: 'blur', radius: 12 });
      expect(saveLastSettingsSpy).toHaveBeenCalledTimes(1);
      expect(lastSavedSettings).toEqual(baseline);
    });

    it('normalizes a legacy figure committed through the dedicated ellipse tool', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'ellipse');

      act(() => {
        rendered.result.current.tool.patchToolArgs('ellipse', { figure: 'circle' as unknown as 'oval' });
      });

      expect(refArgs(rendered).figure).toBe('oval');
      expect(firstPersistedArgs()).toMatchObject({ figure: 'oval', toolName: 'ellipse' });
      expect((lastSavedSettings.ellipse as { figure?: unknown }).figure).toBe('oval');
      expect(rendered.result.current.tool.getToolArgs('ellipse')?.figure).toBe('oval');
    });

    it('keeps a crop patch free of any figure key and leaves other saved tools alone', () => {
      const rendered = renderHarness();
      selectTool(rendered, 'crop');

      expect(() => {
        act(() => {
          rendered.result.current.tool.patchToolArgs('crop', { aspectRatio: 1 });
        });
        act(() => {
          rendered.result.current.tool.resetToLastSavedArgs('crop');
        });
        rendered.result.current.tool.getToolArgs('crop');
      }).not.toThrow();

      expect(lastSavedSettings.crop).toMatchObject({ toolName: 'crop', aspectRatio: 1 });
      expect('figure' in (lastSavedSettings.crop as object)).toBe(false);
      expect(lastSavedSettings.shape).toEqual(baseline.shape);
      expect(lastSavedSettings.draw).toEqual(baseline.draw);
    });
  });
});

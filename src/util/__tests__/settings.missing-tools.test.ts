import { cloneDeep } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { saveLastSettings } from '../settings.ts';
import { defaultSettings, lastSavedSettings } from '../../tools/settings.ts';
import type { ToolArgs, ToolArgsFor, ToolName } from '../../contexts/tool-types.ts';
import type { EraserToolArgs } from '../../tools/eraser.ts';
import type { FillToolArgs, FillToolName } from '../../tools/fill.ts';
import type { EyedropperToolArgs } from '../../tools/eyedropper.ts';

/** Mirrors `src/util/__tests__/settings.test.ts`: the saved map is shared module state. */
const resetLastSavedSettings = () => {
  for (const key of Object.keys(lastSavedSettings)) {
    if (!Object.hasOwn(defaultSettings, key)) delete (lastSavedSettings as Record<string, unknown>)[key];
  }
  Object.assign(lastSavedSettings, cloneDeep(defaultSettings));
};

/**
 * The read side of a tool switch: `CurrentToolProvider` hands the incoming tool its args by
 * deep-cloning `lastSavedSettings[toolName]` (src/contexts/useCurrentTool.tsx:33-51). Nothing else
 * carries a tool's settings across a switch.
 */
const switchToTool = <TName extends ToolName>(toolName: TName): ToolArgsFor<TName> =>
  cloneDeep(lastSavedSettings[toolName]) as ToolArgsFor<TName>;

const eraserArgs = (overrides: Partial<EraserToolArgs> = {}): ToolArgs =>
  ({
    ...defaultSettings.eraser,
    toolName: 'eraser',
    mode: 'block',
    lineWidth: 220,
    alpha: 0.35,
    color: '#12ab34',
    points: [],
    ...overrides,
  }) as unknown as ToolArgs;

const fillArgs = (toolName: FillToolName, overrides: Partial<FillToolArgs> = {}): ToolArgs =>
  ({
    ...defaultSettings[toolName],
    toolName,
    tolerance: 210,
    contiguous: false,
    alpha: 0.6,
    color: '#ff8800',
    pos: { x: 41, y: 17 },
    size: { width: 800, height: 600 },
    ...overrides,
  }) as unknown as ToolArgs;

/**
 * Every assertion in this file checks a VALUE, not a key. The bare-`{ toolName }` persistence arm
 * writes the key and discards every field on the same tick, and a test that only asserted
 * `toolName in lastSavedSettings` passed happily against it.
 */
describe('saveLastSettings for the four new tools', () => {
  beforeEach(resetLastSavedSettings);
  afterEach(resetLastSavedSettings);

  it('keeps every Eraser setting the user chose', () => {
    saveLastSettings(eraserArgs());

    expect(lastSavedSettings.eraser).toEqual({
      toolName: 'eraser',
      mode: 'block',
      lineWidth: 220,
      alpha: 0.35,
      color: '#12ab34',
      points: [],
    });
  });

  it('keeps the Magic Eraser settings and drops the click geometry', () => {
    saveLastSettings(fillArgs('magic-eraser'));
    const saved = lastSavedSettings['magic-eraser'] as unknown as FillToolArgs;

    expect(saved.tolerance).toBe(210);
    expect(saved.contiguous).toBe(false);
    expect(saved.alpha).toBe(0.6);
    expect(saved.color).toBe('#ff8800');
    // `pos`/`size` belong to the click, not to the tool, exactly as `points` does for the brush.
    expect(Object.hasOwn(saved, 'pos')).toBe(false);
    expect(Object.hasOwn(saved, 'size')).toBe(false);
  });

  it('keeps the Paint Bucket settings and drops the click geometry', () => {
    saveLastSettings(fillArgs('paint-bucket'));
    const saved = lastSavedSettings['paint-bucket'] as unknown as FillToolArgs;

    expect(saved.tolerance).toBe(210);
    expect(saved.contiguous).toBe(false);
    expect(saved.alpha).toBe(0.6);
    expect(saved.color).toBe('#ff8800');
    expect(Object.hasOwn(saved, 'pos')).toBe(false);
    expect(Object.hasOwn(saved, 'size')).toBe(false);
  });

  it('keeps the Eyedropper Sample Size', () => {
    saveLastSettings({ ...defaultSettings.eyedropper, sampleSize: 5 } as EyedropperToolArgs);

    expect(lastSavedSettings.eyedropper).toEqual({
      toolName: 'eyedropper',
      sampleSize: 5,
      sampleAllLayers: false,
    });
  });

  it('survives a real tool switch, which is the only path the settings take', () => {
    saveLastSettings(eraserArgs());
    saveLastSettings({ ...defaultSettings.draw, points: [] } as ToolArgs);

    const restored = switchToTool('eraser');
    expect(restored.mode).toBe('block');
    expect(restored.lineWidth).toBe(220);
    expect(restored.alpha).toBe(0.35);
    expect(restored.color).toBe('#12ab34');
  });

  it('round-trips a Magic Eraser switch through the read path', () => {
    saveLastSettings(fillArgs('magic-eraser'));
    saveLastSettings({ ...defaultSettings.draw, points: [] } as ToolArgs);

    const restored = switchToTool('magic-eraser') as unknown as FillToolArgs;
    expect(restored.tolerance).toBe(210);
    expect(restored.contiguous).toBe(false);
    expect(restored.alpha).toBe(0.6);
  });

  it('deep-clones, so mutating the live args cannot reach back into the saved settings', () => {
    const args = eraserArgs() as unknown as EraserToolArgs;
    saveLastSettings(args as unknown as ToolArgs);

    args.lineWidth = 999;
    args.points.push({ x: 1, y: 1 });

    expect(lastSavedSettings.eraser.lineWidth).toBe(220);
    expect(lastSavedSettings.eraser.points).toEqual([]);
  });
});

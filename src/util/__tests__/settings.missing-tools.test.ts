import { cloneDeep } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import settingsSource from '../settings.ts?raw';
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

  /**
   * `saveLastSettings` is one `else if` chain, so a tool named in two arms is served by whichever
   * comes first and the later one is DEAD CODE — while still reading as the arm that governs the
   * tool. The eraser carried exactly that: a typed arm, and then a second listing in the brush
   * group whose comment explained at length why the eraser belonged there rather than in the arm
   * above. Nothing failed, because the two arms happened to persist the same fields.
   *
   * This reads the chain as text on purpose. Every other assertion in this file goes through the
   * public function and can only observe the arm that WINS, which is precisely why the dead one
   * was invisible: a behaviour test cannot distinguish "this arm exists and runs" from "this arm
   * exists and never runs".
   */
  it('names each tool in exactly one arm of the persistence chain', () => {
    const anchor = settingsSource.indexOf('export function saveLastSettings');
    // `indexOf` returning -1 would make `slice` return a one-character string and the assertion
    // below would pass on an empty match — a green test that checked nothing. Fail loudly instead.
    expect(anchor, 'saveLastSettings is not where this test looks for it').toBeGreaterThan(-1);
    const chain = settingsSource.slice(anchor);

    // Tool names as they are compared in the chain: `toolName === 'brush'`, or an element of an
    // `||` list, which this file also spells that way. Each must be the FIRST match for that tool,
    // so a second occurrence is a duplicate arm that can never run.
    const seen = new Map<string, number>();
    for (const [, name] of chain.matchAll(/toolName === '([a-z-]+)'/g)) {
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }

    // A chain that named no tool at all would satisfy the duplicate check for the same reason, so
    // require that it names a plausible number of them before concluding any of it is a duplicate.
    expect(seen.size).toBeGreaterThan(20);

    const duplicated = [...seen].filter(([, count]) => count > 1).map(([name]) => name);
    expect(duplicated).toEqual([]);
  });

  it('keeps every Eraser setting the user chose', () => {
    saveLastSettings(eraserArgs());

    expect(lastSavedSettings.eraser).toEqual({
      toolName: 'eraser',
      mode: 'block',
      lineWidth: 220,
      alpha: 0.35,
      // The Brush tip's two fields. Persisting them is the point of the arm: a session that
      // reopens in Brush mode with the seeded hardness and spacing, whatever the user set.
      hardness: defaultSettings.eraser.hardness,
      spacing: defaultSettings.eraser.spacing,
      color: '#12ab34',
      points: [],
    });
  });

  it('keeps the Magic Eraser settings and drops the click position', () => {
    saveLastSettings(fillArgs('magic-eraser'));
    const saved = lastSavedSettings['magic-eraser'] as unknown as FillToolArgs;

    expect(saved.tolerance).toBe(210);
    expect(saved.contiguous).toBe(false);
    expect(saved.alpha).toBe(0.6);
    expect(saved.color).toBe('#ff8800');
    // `pos` is the click, not a setting, exactly as `points` is for the brush. It is the ONLY thing
    // the arm omits: `FillToolArgs` declares no `size` for it to drop, so a second omission key
    // here would be asserting a field the type no longer has.
    expect(Object.hasOwn(saved, 'pos')).toBe(false);
  });

  it('keeps the Paint Bucket settings and drops the click position', () => {
    saveLastSettings(fillArgs('paint-bucket'));
    const saved = lastSavedSettings['paint-bucket'] as unknown as FillToolArgs;

    expect(saved.tolerance).toBe(210);
    expect(saved.contiguous).toBe(false);
    expect(saved.alpha).toBe(0.6);
    expect(saved.color).toBe('#ff8800');
    expect(Object.hasOwn(saved, 'pos')).toBe(false);
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

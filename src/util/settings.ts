import { cloneDeep, omit } from 'lodash-es';
import { lastSavedSettings } from '../tools/settings.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';

import type { TextToolArgs } from '../tools/text.ts';
import { normalizeFigure, type ShapeToolArgs } from '../tools/shape.ts';
import type { CropToolArgs } from '../tools/crop.ts';
import type { BlurToolArgs } from '../tools/blur.ts';
import type { ColorsToolArgs } from '../tools/colors.ts';
import type { LevelsToolArgs } from '../tools/levels.ts';
import type { FillToolArgs } from '../tools/fill.ts';

/**
 * Tool args may arrive from an older build that still had dedicated Circle and
 * Square tools. Map those figures onto their Photoshop base tool so a saved
 * shape style is never dropped on the floor.
 */
const withNormalizedFigure = <T extends ShapeToolArgs>(args: ShapeToolArgs): T =>
  ({ ...args, figure: normalizeFigure(args.figure) }) as T;

export function saveLastSettings(args: ToolArgs) {
  const { toolName } = args;
  if (!toolName) {
    throw new Error('Tool name required');
  }

  if (toolName === 'draw') {
    lastSavedSettings.draw = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'text') {
    lastSavedSettings.text = cloneDeep(omit(args as TextToolArgs, 'text', 'rect'));
  } else if (toolName === 'shape') {
    lastSavedSettings.shape = cloneDeep(withNormalizedFigure(omit(args as ShapeToolArgs, 'start', 'end')));
  } else if (toolName === 'crop') {
    // `preRatioRect` goes the way `rect` does. `aspectRatio` is persisted while the rect is not, so a
    // restored session arrives with a ratio and no rect; a persisted pre-ratio rect would fill that
    // gap from a different document, and the next `Free`/`Original` would restore a framing the user
    // never drew on this one. Both are presentation state.
    lastSavedSettings.crop = cloneDeep(omit(args as CropToolArgs, 'rect', 'preRatioRect'));
  } else if (toolName === 'transform') {
    lastSavedSettings.transform = cloneDeep(args);
  } else if (toolName === 'reposition') {
    lastSavedSettings.reposition = cloneDeep(args);
  } else if (toolName === 'polygonal-lasso') {
    lastSavedSettings['polygonal-lasso'] = cloneDeep(args);
  } else if (toolName === 'freehand-lasso') {
    lastSavedSettings['freehand-lasso'] = cloneDeep(args);
  } else if (toolName === 'feather-magnetic-lasso') {
    lastSavedSettings['feather-magnetic-lasso'] = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'magic-wand') {
    lastSavedSettings['magic-wand'] = cloneDeep(args);
  } else if (toolName === 'eraser') {
    // A typed arm, not the bare-`{ toolName }` group below: Mode, Size, Opacity and the foreground
    // are all settings the user chose, and a bare arm would discard every one of them on the same
    // tick the tool is switched away from. The point list goes the way `draw`'s does.
    lastSavedSettings.eraser = cloneDeep({ ...args, points: [] });
  } else if (toolName === 'magic-eraser' || toolName === 'paint-bucket') {
    // Same reasoning, and `pos`/`size` are the per-gesture geometry the `draw` and `crop` arms
    // also drop: persisting them would restore the last click's position into the next fill.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      omit(args as unknown as FillToolArgs, 'pos', 'size')
    ) as ToolArgs;
  } else if (toolName === 'eyedropper') {
    // Typed rather than bare even though nothing here is geometric: Sample Size is a real user
    // choice, and the bare group exists for tools whose only setting is that they exist.
    lastSavedSettings.eyedropper = cloneDeep({ ...args });
  } else if (toolName === 'rectangular-selection') {
    lastSavedSettings['rectangular-selection'] = cloneDeep({ toolName: 'rectangular-selection' });
  } else if (toolName === 'triangle' || toolName === 'polygon') {
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      withNormalizedFigure(omit(args as unknown as ShapeToolArgs, 'start', 'end'))
    ) as ToolArgs;
  } else if (toolName === 'brush' || toolName === 'pencil' || toolName === 'color-replacement') {
    // The Photoshop paint bar writes Size, Opacity, Smoothing and Mode through
    // `setToolArgs`, which lands here on every change. Persisting only the tool name
    // — as the arm below still does for the pen and shape families — throws those
    // four away on the same tick, so the next tool switch re-seeds the bar from
    // `{ toolName }` and every control silently resets. `points` is stroke geometry,
    // not a setting, so it is emptied the way `draw` empties it above.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({ ...args, points: [] });
  } else if (
    toolName === 'pen' ||
    toolName === 'freeform-pen' ||
    toolName === 'curvature-pen' ||
    toolName === 'add-anchor-point' ||
    toolName === 'delete-anchor-point' ||
    toolName === 'convert-point' ||
    toolName === 'custom-shape'
  ) {
    (lastSavedSettings as Record<string, { toolName: string }>)[toolName] = cloneDeep({ toolName });
  } else if (toolName === 'rectangle' || toolName === 'ellipse' || toolName === 'line') {
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({
      ...(lastSavedSettings[toolName] ?? {}),
      ...(args as ToolArgs),
    });
  } else if (toolName === 'blur') {
    lastSavedSettings.blur = cloneDeep(args as BlurToolArgs);
  } else if (toolName === 'color') {
    lastSavedSettings.color = cloneDeep(args as ColorsToolArgs);
  } else if (toolName === 'levels') {
    lastSavedSettings.levels = cloneDeep(args as LevelsToolArgs);
  } else if (
    toolName === 'elliptical-selection' ||
    toolName === 'quick-selection' ||
    toolName === 'gradient' ||
    toolName === 'sharpen'
  ) {
    // None of these carry stroke geometry, so the whole args object is the
    // settings — the same treatment the magic wand gets above.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(args);
  } else if (
    toolName === 'smudge' ||
    toolName === 'dodge' ||
    toolName === 'burn' ||
    toolName === 'clone-stamp' ||
    toolName === 'eraser'
  ) {
    // These five are brushes, so `points` is the stroke that was just committed and not
    // a setting: reseeding it would hand the next drag the previous one. Emptied the
    // way `draw` (:27) and `feather-magnetic-lasso` (:44) empty theirs. Note that
    // `clone-stamp.source` survives — a source point is a setting, and losing it is the
    // difference between "stamp where you last cloned" and "stamp nothing".
    //
    // The eraser is here rather than in the arm above for exactly that reason: it erases
    // along a stroke, so its `points` is the stroke too, and `EraserToolArgs.points` is
    // required rather than optional. Persisting the last erased stroke would reappear in
    // the options bar on the next tool switch.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({ ...args, points: [] });
  } else {
    // Every `ToolName` is persisted above by design. Without this trap a tool added to
    // `ToolArgsByName` falls off the end of the chain, its settings are dropped, and its sliders
    // silently reset on the next switch. Adding a tool without adding an arm here is a typecheck error.
    const _exhaustive: never = toolName;
    void _exhaustive;
  }
}

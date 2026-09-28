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
import type { ColorReplacementToolArgs } from '../tools/colorReplacement.ts';

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
    lastSavedSettings.crop = cloneDeep(omit(args as CropToolArgs, 'rect'));
    // deliberately not storing for those three because they have a different philosophy, unfortunately
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
  } else if (toolName === 'color-replacement') {
    // A typed arm, NOT the bare-`{ toolName }` group below. That group discarded every setting
    // this tool has, which is why the seeded Tolerance and Limits were the only configuration a
    // user could ever reach: the sliders existed nowhere and `defaultSettings` was the whole of
    // the tool's state.
    //
    // `points` and `sampleColor` are dropped for the reason `draw` drops `points` and the fill arm
    // drops `pos`/`size`: they describe one gesture, not a setting. Restoring the last drag's path
    // would paint where the user last let go, and restoring the last click's colour would arm the
    // tool with a sample the user never chose for this session — Photoshop returns the tool to
    // asking when you switch away and back, and so does this.
    //
    // The `color` that REMAINS is not the foreground: it is the foreground as of the last
    // committed stroke, and the tool area overwrites it from the live store at every gesture
    // (`ColorReplacementToolArea.tsx`, the `FillToolArea.tsx:132-148` precedent), so persisting it
    // cannot pin a colour.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      omit(args as unknown as ColorReplacementToolArgs, 'points', 'sampleColor')
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
  } else if (
    toolName === 'brush' ||
    toolName === 'pencil' ||
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
  } else {
    // Every `ToolName` is persisted above by design. Without this trap a tool added to
    // `ToolArgsByName` falls off the end of the chain, its settings are dropped, and its sliders
    // silently reset on the next switch. Adding a tool without adding an arm here is a typecheck error.
    const _exhaustive: never = toolName;
    void _exhaustive;
  }
}

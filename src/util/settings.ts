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
    lastSavedSettings.text = cloneDeep(omit(args as TextToolArgs, 'text', 'rect', 'kind', 'placeholderUntouched'));
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
    // Same reasoning, and `pos` is the per-gesture geometry the `draw` and `crop` arms also drop:
    // persisting it would restore the last click's position into the next fill. It is the only
    // omission key left because `FillToolArgs` no longer declares a `size` for the arm to drop.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      omit(args as unknown as FillToolArgs, 'pos')
    ) as ToolArgs;
  } else if (toolName === 'color-replacement') {
    // A typed arm, NOT the bare-`{ toolName }` group below. That group discarded every setting
    // this tool has, which is why the seeded Tolerance and Limits were the only configuration a
    // user could ever reach: the sliders existed nowhere and `defaultSettings` was the whole of
    // the tool's state.
    //
    // `points` and `sampleColor` are dropped for the reason `draw` drops `points` and the fill arm
    // drops `pos`: they describe one gesture, not a setting. Restoring the last drag's path
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
  } else if (
    toolName === 'rectangular-selection' ||
    toolName === 'single-row-marquee' ||
    toolName === 'single-column-marquee' ||
    toolName === 'ruler'
  ) {
    // Typed rather than falling through to the bare group below, because a tool with NO
    // settings still has to persist its identity: an unmatched `toolName` never reaches
    // `lastSavedSettings` at all, and `cloneSavedToolArgs` then seeds the bar from
    // `defaultSettings` on every switch. Harmless for these three today, and the reason
    // this arm exists rather than a note is that it stops being harmless the day one of
    // them grows a control.
    //
    // The Ruler joins them for the same reason and for a second one: its args are `{ toolName }` and
    // nothing else, so this arm persists an object that is byte-identical to the default. That is
    // still the point — the trap at the end of this chain is what makes adding a tool without
    // adding an arm a typecheck error, and a measurement line is deliberately NOT persisted (see
    // `PIXEL_FREE_TOOLS`), so there is nothing here that could hold one.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({ toolName });
  } else if (toolName === 'triangle' || toolName === 'polygon') {
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep(
      withNormalizedFigure(omit(args as unknown as ShapeToolArgs, 'start', 'end'))
    ) as ToolArgs;
  } else if (toolName === 'brush' || toolName === 'pencil') {
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
    toolName === 'sponge' ||
    toolName === 'clone-stamp'
  ) {
    // These five are brushes, so `points` is the stroke that was just committed and not
    // a setting: reseeding it would hand the next drag the previous one. Emptied the
    // way `draw` and `feather-magnetic-lasso` empty theirs. Note that
    // `clone-stamp.source` survives — a source point is a setting, and losing it is the
    // difference between "stamp where you last cloned" and "stamp nothing".
    //
    // The eraser is NOT in this group, and must not be added to it. It erases along a
    // stroke too, so the same reasoning applies to it — but it also has settings of its
    // own (Mode, Size, Opacity, the foreground), which is why it has its own typed arm
    // earlier in this chain that already empties `points`. It used to be listed here as
    // well, which made this arm unreachable for it and left a comment justifying a
    // placement that had been dead for as long as the typed arm existed: an `else if`
    // chain takes its first match, so the later duplicate could never run.
    (lastSavedSettings as Record<string, ToolArgs>)[toolName] = cloneDeep({ ...args, points: [] });
  } else {
    // Every `ToolName` is persisted above by design. Without this trap a tool added to
    // `ToolArgsByName` falls off the end of the chain, its settings are dropped, and its sliders
    // silently reset on the next switch. Adding a tool without adding an arm here is a typecheck error.
    const _exhaustive: never = toolName;
    void _exhaustive;
  }
}

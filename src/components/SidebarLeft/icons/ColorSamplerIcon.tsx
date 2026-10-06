import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * Photoshop's Color Sampler: a crosshair with a label beside it.
 *
 * **The crosshair is drawn because the marker is drawn**, and the marker's glyph is not Adobe's to
 * copy — no Adobe sentence describes it, and the sources disagree between a crosshair and a target
 * icon. The rail icon and the canvas marker are the same shape for the same reason: a tile that
 * showed a different glyph from the one the tool draws would be showing two symbols for one idea.
 * See `drawColorSamplerMarker` in `src/components/Main/ColorSamplerToolArea.tsx`.
 *
 * The label is the half every source agrees on — they all describe a sequential number beside the
 * glyph — and here it is drawn as two bars rather than as a digit, because `1` at 20px is a stroke
 * and reads as an artefact rather than as a number.
 */
export const ColorSamplerIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M16 5.5v21M5.5 16h21" stroke={STROKE} strokeLinecap="round" strokeWidth="4.4" opacity="0.22" />
    <path d="M16 5.5v21M5.5 16h21" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M24 9.5v9M28.5 11.5v5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
  </IconShell>
);

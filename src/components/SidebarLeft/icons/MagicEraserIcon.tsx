import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * Photoshop's Magic Eraser. Deliberately not `MagicWandIcon`: a wand that erases reads as a wand
 * to select, and the two tools live three tiles apart.
 */
export const MagicEraserIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m6.5 27 13-13" stroke={STROKE} strokeLinecap="round" strokeWidth="2.8" />
    <path d="m15.5 12 4 4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" opacity=".65" />
    <path
      d="m20 3 1.2 2.8L24 7l-2.8 1.2L20 11l-1.2-2.8L16 7l2.8-1.2L20 3ZM27 12l.9 2.1L30 15l-2.1.9L27 18l-.9-2.1L24 15l2.1-.9L27 12ZM6 6l.8 1.7L8.5 8.5l-1.7.8L6 11l-.8-1.7L3.5 8.5l1.7-.8L6 6Z"
      fill={STROKE}
    />
    <path d="M21 21h8v8h-8z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" opacity=".8" />
    <path d="M21 21h8v8h-8z" fill={STROKE} opacity=".2" />
  </IconShell>
);

import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * A tilted frame with a rotation arrow around it.
 *
 * The TILT is the load-bearing part of this glyph. A circular arrow alone is indistinguishable
 * from Rotate (`transform-rotate`, which this rail already carries), and that tool rotates the
 * PIXELS while this one rotates the VIEW — two operations a user must never confuse, because one
 * is undoable and the other is not. The skewed quadrilateral is what separates them at 28px: it
 * reads as a frame being turned rather than an object being turned inside it.
 */
export const RotateViewIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    {/* The frame, tilted. Two quadrilaterals rather than one rotated rect so the tilt reads at
        this size without the corners crossing. */}
    <path d="M7.6 11.4 24.2 8.6l3 7.2-16.6 2.8Z" fill={STROKE} opacity="0.14" />
    <path d="M7.6 11.4 24.2 8.6l3 7.2-16.6 2.8Z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    {/* The rotation arrow, open at the top-right so the arrowhead reads as a turn. */}
    <path d="M6.4 21.6a11.4 11.4 0 0 0 17.8 3.2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M21.4 22.2a11.4 11.4 0 0 0-1.9-5.2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="m18.6 14.6 2.6 2.6-3.4 1.4Z" fill={STROKE} />
  </IconShell>
);

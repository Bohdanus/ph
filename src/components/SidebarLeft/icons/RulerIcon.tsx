import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * Photoshop's Ruler: a diagonal measuring rule with its tick marks.
 *
 * A ruler rather than a protractor, because the protractor is the same tool's second gesture and a
 * rail tile has room for one idea. The ticks alternate in length the way a rule's edge markings do,
 * which is what makes the shape read as "measures" at 20px instead of reading as a plain line.
 */
export const RulerIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M7.5 24.5 24.5 7.5" stroke={STROKE} strokeLinecap="round" strokeWidth="4.4" opacity="0.22" />
    <path d="M7.5 24.5 24.5 7.5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M11.6 20.4 14.2 23" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
    <path d="M15.5 16.5 18.1 19.1" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
    <path d="M19.4 12.6 22 15.2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
    <path d="M9.2 25.8 25.8 9.2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M6.5 20.5 20.5 6.5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
  </IconShell>
);

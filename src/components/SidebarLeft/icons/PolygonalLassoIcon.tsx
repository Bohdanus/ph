import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const PolygonalLassoIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m6 21 5-13 14 4 1 10-11 5-9-6Z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    <path d="m6 21 5-13 14 4" stroke={STROKE} strokeDasharray="2 1.5" strokeWidth="1.2" opacity=".6" />
    <circle cx="6" cy="21" r="2" fill={STROKE} />
    <path d="m15 27 8 1" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
  </IconShell>
);

import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const ColorIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="5" y="4" width="16" height="16" fill="white" stroke={STROKE} strokeWidth="1.8" />
    <rect x="11" y="12" width="16" height="16" fill="black" stroke={STROKE} strokeWidth="1.8" />
    <path d="m25 4 3 3M25 7l3-3" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

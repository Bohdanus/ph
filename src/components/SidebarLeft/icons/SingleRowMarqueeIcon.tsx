import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const SingleRowMarqueeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="4" y="6" width="24" height="20" fill={STROKE} opacity=".08" />
    <path d="M4 16h24" stroke={STROKE} strokeDasharray="3 2" strokeWidth="1.9" />
  </IconShell>
);

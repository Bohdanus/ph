import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const SingleColumnMarqueeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="6" y="4" width="20" height="24" fill={STROKE} opacity=".08" />
    <path d="M16 4v24" stroke={STROKE} strokeDasharray="3 2" strokeWidth="1.9" />
  </IconShell>
);

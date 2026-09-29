import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const EllipticalSelectionIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <ellipse cx="16" cy="16" fill={STROKE} opacity=".1" rx="11" ry="8" />
    <ellipse cx="16" cy="16" rx="11" ry="8" stroke={STROKE} strokeDasharray="3 2" strokeWidth="1.9" />
  </IconShell>
);

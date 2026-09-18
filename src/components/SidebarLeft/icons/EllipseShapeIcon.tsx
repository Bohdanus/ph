import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const EllipseShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <ellipse cx="16" cy="16" rx="11" ry="8.5" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

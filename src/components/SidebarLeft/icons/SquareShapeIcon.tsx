import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const SquareShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="7" y="7" width="18" height="18" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

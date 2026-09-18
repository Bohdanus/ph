import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const CircleShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" r="9" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

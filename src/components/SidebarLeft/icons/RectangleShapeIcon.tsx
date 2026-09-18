import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const RectangleShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="6" y="7" width="20" height="18" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

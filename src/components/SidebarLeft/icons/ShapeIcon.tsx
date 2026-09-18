import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const ShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M5 7h12v10H5z" fill={STROKE} opacity=".16" stroke={STROKE} strokeWidth="1.8" />
    <circle cx="21.5" cy="21" r="6.5" fill={STROKE} opacity=".25" stroke={STROKE} strokeWidth="1.8" />
    <path d="m12 27-4-6-4 6h8Z" fill={STROKE} opacity=".8" />
  </IconShell>
);

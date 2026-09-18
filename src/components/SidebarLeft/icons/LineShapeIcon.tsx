import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const LineShapeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m6 26 20-20" stroke={STROKE} strokeLinecap="round" strokeWidth="2.2" />
    <path d="m6 26 4-1M6 26l1-4M26 6l-4 1M26 6l-1 4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

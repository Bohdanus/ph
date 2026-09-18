import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const CropIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M10 4v18h18M4 10h18v18" stroke={STROKE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    <path d="M10 10h12v12H10z" fill={STROKE} opacity=".12" />
    <path d="M7 7h6M7 7v6M25 25h-6M25 25v-6" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".7" />
  </IconShell>
);

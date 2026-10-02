import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const BurnIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" fill={STROKE} fillOpacity=".12" r="9.5" stroke={STROKE} strokeWidth="1.9" />
    <circle cx="16" cy="16" fill={STROKE} r="2.6" />
    <circle cx="16" cy="16" fill="none" r="6" stroke={STROKE} strokeWidth="1.5" />
    <path d="M16 4.5v2.5M16 25v2.5M4.5 16H7M25 16h2.5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

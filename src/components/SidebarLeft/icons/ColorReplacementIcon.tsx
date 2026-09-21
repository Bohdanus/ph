import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const ColorReplacementIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="6" y="7" width="20" height="18" rx="2" fill={STROKE} opacity="0.12" stroke={STROKE} strokeWidth="1.7" />
    <path d="M9.5 18c2.7-5.2 6.8-7.2 11-9.2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.6" opacity="0.7" />
    <circle cx="22" cy="10" r="3.5" fill="#ff8a65" opacity="0.8" />
    <circle cx="12" cy="20" r="3.2" fill="#5ea7ff" opacity="0.9" />
  </IconShell>
);

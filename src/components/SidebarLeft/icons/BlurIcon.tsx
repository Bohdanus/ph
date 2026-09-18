import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const BlurIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M16 3.5s8 9.3 8 15a8 8 0 1 1-16 0c0-5.7 8-15 8-15Z" fill={STROKE} opacity=".22" />
    <path d="M16 3.5s8 9.3 8 15a8 8 0 1 1-16 0c0-5.7 8-15 8-15Z" stroke={STROKE} strokeWidth="1.8" />
    <path d="M11.5 18.5c.4 2.2 1.8 3.8 4 4.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".65" />
    <circle cx="20" cy="17" r="1.2" fill={STROKE} opacity=".55" />
  </IconShell>
);

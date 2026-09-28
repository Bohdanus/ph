import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const DodgeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" fill={STROKE} fillOpacity=".12" r="9.5" stroke={STROKE} strokeWidth="1.9" />
    <circle cx="13" cy="14" fill={STROKE} r="3.2" />
    <path d="M16 6.5v3.5M25.5 16H22M16 25.5V22M6.5 16H10" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

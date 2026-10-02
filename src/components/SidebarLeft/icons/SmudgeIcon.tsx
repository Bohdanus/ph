import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const SmudgeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M16 4.5c1.2 2.7 2.6 3.6 2.6 5.6 0 1.4-1.1 2.4-2.6 2.4s-2.6-1-2.6-2.4c0-2 1.4-2.9 2.6-5.6Z"
      fill={STROKE}
      fillOpacity=".2"
      stroke={STROKE}
      strokeWidth="1.8"
    />
    <path d="M16 13.5v4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path
      d="M7.5 20.5c2.7 0 3.6 1.4 5.6 1.4 1.4 0 2.4-1.1 2.4-2.6 0-1.5-1-2.6-2.4-2.6-2 0-2.9 1.4-5.6 2.6Z"
      stroke={STROKE}
      strokeWidth="1.6"
    />
    <path d="M24.5 20.5c-2.7 0-3.6 1.4-5.6 1.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.6" />
  </IconShell>
);

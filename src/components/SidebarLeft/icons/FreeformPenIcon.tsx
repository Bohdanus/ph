import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const FreeformPenIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M7 23.5c2.8-2.8 5.4-5.3 8.2-7.5 3-2.4 5-4.7 8-7.6"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.8"
    />
    <path
      d="M8 25.5c1.8-1.7 3.4-3.1 5.2-4.5 3.1-2.4 5.1-4.7 7.6-7.1"
      fill="none"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.1"
      opacity="0.8"
    />
    <circle cx="21.5" cy="9" r="2.2" fill={STROKE} opacity="0.25" stroke={STROKE} strokeWidth="1.2" />
  </IconShell>
);

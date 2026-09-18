import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const FeatherMagneticLassoIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M7 17c-1.1-5.5 5.7-10.4 12.5-8.3 6.3 2 6.7 8.9 1.4 12.5-5.4 3.7-12.9 2.3-13.9-1.7Z"
      stroke={STROKE}
      strokeDasharray="2.5 1.8"
      strokeLinecap="round"
      strokeWidth="1.9"
    />
    <path d="m19.8 21.5 6 5.8" stroke={STROKE} strokeLinecap="round" strokeWidth="2" />
    <path d="M9 8.5v3M13 6.8v3M17 6.5v3M21 8v3" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
    <circle cx="16" cy="17" r="2" fill={STROKE} />
  </IconShell>
);

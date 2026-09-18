import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const FreehandLassoIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M7 17c-1.7-5.6 5.4-10.9 12.8-8.4 6.9 2.3 6.8 9.5 1.2 13.1-5.2 3.4-13.3 1.9-14-2.4Z"
      stroke={STROKE}
      strokeDasharray="2.5 1.8"
      strokeLinecap="round"
      strokeWidth="2"
    />
    <path d="M19.5 21.8c1.8 1.6 3.5 3.2 5.6 5.7" stroke={STROKE} strokeLinecap="round" strokeWidth="2.1" />
    <circle cx="19.5" cy="21.8" r="1.8" fill={STROKE} />
  </IconShell>
);

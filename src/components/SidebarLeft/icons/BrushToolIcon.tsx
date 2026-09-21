import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const BrushToolIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M7 23.5c1.2-5.2 6.1-7.5 10-9.5 2.8-1.5 4.4-4.5 5.4-7.5 1.4 1.2 2.6 3.3 2.6 5.5 0 2.7-1.5 4.8-4.2 6.2-2.3 1.2-5.1 2.4-7.1 4.6-1.8 2-2.6 4.2-4.7 4.7-2.1.5-4.1-1.5-4-3.5Z"
      fill={STROKE}
      opacity="0.18"
      stroke={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path
      d="M8.5 21.5c2.5-2.7 7.1-3.8 9.9-5.4 2.8-1.6 5.4-4.4 6.1-7.6"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.4"
      opacity="0.8"
    />
    <circle cx="20.5" cy="8.5" r="1.8" fill={STROKE} />
  </IconShell>
);

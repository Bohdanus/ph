import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const StarIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="m16 3 3.2 8.1 8.7.5-6.7 5.5 2.2 8.5-7.4-4.7-7.4 4.7 2.2-8.5-6.7-5.5 8.7-.5L16 3Z"
      fill={STROKE}
      opacity=".2"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </IconShell>
);

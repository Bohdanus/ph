import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const TransformIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="8" y="8" width="16" height="16" stroke={STROKE} strokeWidth="1.8" />
    <path
      d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"
      stroke={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.1"
    />
    <path
      d="m5 5 4 4M27 5l-4 4M27 27l-4-4M5 27l4-4"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.4"
      opacity=".7"
    />
  </IconShell>
);

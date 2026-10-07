import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const RedEyeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M4.2 16c2.8-4.6 6.7-7 11.8-7s9 2.4 11.8 7c-2.8 4.6-6.7 7-11.8 7S7 20.6 4.2 16Z"
      fill="none"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="2"
    />
    <circle cx="16" cy="16" r="4.6" fill="#d93025" />
    <circle cx="16" cy="16" r="1.7" fill="#222" />
  </IconShell>
);

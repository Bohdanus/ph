import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const PenToolIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="m7 23 12.6-12.6 4.4 4.4L11.4 27.4 7 23Z"
      fill={STROKE}
      opacity="0.14"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.7"
    />
    <path
      d="M19.8 8.8 24 4.6l3.2 3.2-4.2 4.2"
      stroke={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path d="M8.5 23.5 5 27l3.5-3.5Z" fill={STROKE} opacity="0.7" />
    <path d="m7 23 5.5-5.5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity="0.75" />
  </IconShell>
);

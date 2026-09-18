import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const DrawIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m7 25 13.8-13.8 4 4L11 29H7v-4Z" fill={STROKE} opacity=".2" />
    <path d="m7 25 13.8-13.8 4 4L11 29H7v-4Z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    <path d="m20.8 11.2 3.5-3.5 4 4-3.5 3.5-4-4Z" fill={STROKE} />
    <path
      d="M8.5 8.5c2.6 0 2.6 3.5 5.2 3.5s2.6-3.5 5.2-3.5"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.5"
      opacity=".7"
    />
  </IconShell>
);

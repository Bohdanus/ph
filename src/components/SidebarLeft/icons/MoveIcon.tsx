import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const MoveIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M16 3.5v25M3.5 16h25" stroke={STROKE} strokeLinecap="round" strokeWidth="2.1" />
    <path
      d="m16 3.5-4.1 4.1h8.2L16 3.5ZM16 28.5l4.1-4.1h-8.2l4.1 4.1ZM3.5 16l4.1-4.1v8.2L3.5 16ZM28.5 16l-4.1 4.1v-8.2l4.1 4.1Z"
      fill={STROKE}
    />
  </IconShell>
);

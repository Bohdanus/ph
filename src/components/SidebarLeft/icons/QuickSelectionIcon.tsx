import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const QuickSelectionIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M16 5.5c5.2 0 9.5 4.3 9.5 9.5 0 5.2-4.3 9.5-9.5 9.5" stroke={STROKE} strokeWidth="1.9" />
    <path
      d="M16 5.5c-5.2 0-9.5 4.3-9.5 9.5 0 5.2 4.3 9.5 9.5 9.5"
      stroke={STROKE}
      strokeDasharray="3 2.4"
      strokeWidth="1.9"
    />
    <path d="m9 23.5 3-3" stroke={STROKE} strokeLinecap="round" strokeWidth="2" />
    <path d="m9.5 20.5 2.5 2.5-3.6 1.1 1.1-3.6Z" fill={STROKE} />
  </IconShell>
);

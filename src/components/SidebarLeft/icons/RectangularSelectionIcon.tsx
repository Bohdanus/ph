import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const RectangularSelectionIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <rect x="6" y="7" width="20" height="18" fill={STROKE} opacity=".08" />
    <path d="M6 12V7h5M21 7h5v5M26 20v5h-5M11 25H6v-5" stroke={STROKE} strokeDasharray="3 2" strokeWidth="1.9" />
  </IconShell>
);

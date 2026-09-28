import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const EraserIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M11 22.5h13" stroke={STROKE} strokeLinecap="round" strokeWidth="1.9" />
    <path
      d="m7.2 16.2 8-8a2 2 0 0 1 2.9 0l5.7 5.7a2 2 0 0 1 0 2.9l-6.6 6.6H11L7.2 20a2 2 0 0 1 0-3.8Z"
      fill={STROKE}
      fillOpacity=".12"
      stroke={STROKE}
      strokeWidth="1.9"
    />
    <path d="m11.5 12.5 8 8" stroke={STROKE} strokeLinecap="round" strokeWidth="1.6" opacity=".7" />
  </IconShell>
);

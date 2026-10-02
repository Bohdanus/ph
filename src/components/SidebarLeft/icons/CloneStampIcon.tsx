import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const CloneStampIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M12.5 8.5h7v4h-7z" fill={STROKE} fillOpacity=".2" stroke={STROKE} strokeWidth="1.8" />
    <path d="M9.5 12.5h13l1.5 5h-16l1.5-5Z" stroke={STROKE} strokeWidth="1.8" />
    <path
      d="M11.5 17.5h9v3.2a2.3 2.3 0 0 1-2.3 2.3h-4.4a2.3 2.3 0 0 1-2.3-2.3v-3.2Z"
      fill={STROKE}
      fillOpacity=".12"
      stroke={STROKE}
      strokeWidth="1.8"
    />
    <path d="M16 8.5V5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" />
  </IconShell>
);

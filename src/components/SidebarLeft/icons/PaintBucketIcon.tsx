import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const PaintBucketIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="m8.5 9.5 8.6 6.3a1.6 1.6 0 0 1 0 2.4l-4.3 3.5a1.6 1.6 0 0 1-2.2 0L6.6 13.2l6.4-3.7"
      fill={STROKE}
      fillOpacity=".12"
      stroke={STROKE}
      strokeWidth="1.9"
    />
    <path d="m8.5 9.5-2.4-4.1 3.4-2 2.4 4.1" fill={STROKE} fillOpacity=".25" stroke={STROKE} strokeWidth="1.8" />
    <path d="M17 18.5c0 1.5 1.2 2.2 1.2 3.3a1.2 1.2 0 1 1-2.4 0c0-1.1 1.2-1.8 1.2-3.3Z" fill={STROKE} />
  </IconShell>
);

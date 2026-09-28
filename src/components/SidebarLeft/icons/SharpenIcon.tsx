import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const SharpenIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M6 22.5c2.6 0 4-1.6 6-4s3.4-4 6-4 4-1.6 6-4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.9" />
    <path
      d="M6 27c2.6 0 4-1.6 6-4s3.4-4 6-4 4-1.6 6-4"
      stroke={STROKE}
      strokeLinecap="round"
      strokeOpacity=".4"
      strokeWidth="1.6"
    />
    <path d="M13 4.5 10 10.5M20 4.5l-3 6" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" />
  </IconShell>
);

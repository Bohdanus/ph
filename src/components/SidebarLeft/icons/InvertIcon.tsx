import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const InvertIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" r="10" stroke={STROKE} strokeWidth="1.8" fill="none" />
    <path d="M16 6a10 10 0 0 1 0 20z" fill={STROKE} />
  </IconShell>
);

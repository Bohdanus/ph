import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const EyedropperIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m9 23 3.2-1 11-11a2.26 2.26 0 0 0-3.2-3.2l-11 11L9 23Z" stroke={STROKE} strokeWidth="1.9" />
    <path d="m20.2 8.4 3.4 3.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" />
    <path d="m9 23 1.6-3.9" stroke={STROKE} strokeLinecap="round" strokeWidth="1.6" opacity=".7" />
    <path d="M6 26.5 4.5 28.5" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
  </IconShell>
);

import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const LevelsIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M4 26.5h24" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M6 24V18h3v6M11 24V11h3v13M16 24V7h3v17M21 24v-9h3v9M26 24v-4h1v4" fill={STROKE} />
    <path d="M6 7v2M16 4v2M26 7v2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

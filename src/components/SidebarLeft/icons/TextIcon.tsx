import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const TextIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="M5 5h22v4M16 5v22M11 27h10" stroke={STROKE} strokeLinecap="round" strokeWidth="2.3" />
    <path d="M8 9h16" stroke={STROKE} strokeLinecap="round" strokeWidth="1.3" opacity=".55" />
  </IconShell>
);

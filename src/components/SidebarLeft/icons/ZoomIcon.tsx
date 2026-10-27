import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function ZoomIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <circle cx="13" cy="13" r="7" stroke={STROKE} strokeWidth="1.8" />
      <path d="m18 18 8 8M13 9v8M9 13h8" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    </IconShell>
  );
}

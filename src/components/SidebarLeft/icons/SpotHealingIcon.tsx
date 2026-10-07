import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function SpotHealingIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <path d="M7 22 22 7a4 4 0 0 0-5.7-5.7l-15 15A4 4 0 0 0 7 22Z" stroke={STROKE} strokeWidth="1.8" />
      <path d="M15 5 19 9M19 16v8M15 20h8" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    </IconShell>
  );
}

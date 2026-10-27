import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function HealingBrushIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <path d="M7 22 22 7a4 4 0 0 0-5.7-5.7l-15 15A4 4 0 0 0 7 22Z" stroke={STROKE} strokeWidth="1.8" />
      <path d="M6 6h8M10 2v8" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    </IconShell>
  );
}

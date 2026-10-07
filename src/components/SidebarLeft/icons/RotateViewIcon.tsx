import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function RotateViewIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <path d="M8 11a10 10 0 1 1-1 9" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
      <path d="M8 5v6h6" stroke={STROKE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconShell>
  );
}

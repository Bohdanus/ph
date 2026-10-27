import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function PatchIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <path d="M6 6h12v12H6z" stroke={STROKE} strokeDasharray="2 2" strokeWidth="1.8" />
      <path
        d="m10 14 4-4m0 0v3m0-3h-3"
        stroke={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconShell>
  );
}

import type { ToolIconProps } from '../types';
import { IconShell, STROKE } from './IconShell';

export function HandIcon({ title }: ToolIconProps) {
  return (
    <IconShell title={title}>
      <path
        d="M9 15V7a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v7c0 6-3.5 9-8 9h-2c-2.5 0-4-1.2-5.3-3L6 17a2.2 2.2 0 0 1 3-2Z"
        stroke={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconShell>
  );
}

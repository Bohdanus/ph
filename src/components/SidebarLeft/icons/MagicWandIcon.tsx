import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

export const MagicWandIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path d="m8 25 15-15" stroke={STROKE} strokeLinecap="round" strokeWidth="2.8" />
    <path d="m20.5 7.5 4 4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" opacity=".65" />
    <path
      d="m7 5 .9 2.1L10 8l-2.1.9L7 11l-.9-2.1L4 8l2.1-.9L7 5ZM17 3l.8 1.7L19.5 5l-1.7.8L17 7.5l-.8-1.7L14.5 5l1.7-.8L17 3ZM25 19l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7.8 1.7-.8.8-1.7Z"
      fill={STROKE}
    />
  </IconShell>
);

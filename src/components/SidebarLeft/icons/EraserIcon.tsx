import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/** Photoshop's Eraser: a Block-mode eraser, the only mode this icon can honestly depict. */
export const EraserIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M14.6 5.9 26 17.3a1.8 1.8 0 0 1 0 2.6l-7.2 7.2a1.8 1.8 0 0 1-2.6 0L5 17.7a1.8 1.8 0 0 1 0-2.6l7-7a1.8 1.8 0 0 1 2.6 0Z"
      fill={STROKE}
      opacity="0.18"
    />
    <path
      d="M14.6 5.9 26 17.3a1.8 1.8 0 0 1 0 2.6l-7.2 7.2a1.8 1.8 0 0 1-2.6 0L5 17.7a1.8 1.8 0 0 1 0-2.6l7-7a1.8 1.8 0 0 1 2.6 0Z"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <path d="m8.3 12.6 11.1 11.1" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".7" />
  </IconShell>
);

import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/** Photoshop's Paint Bucket: a tilted bucket with a pour of paint leaving its lip. */
export const PaintBucketIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M11.2 4.4 27 20.2a1.6 1.6 0 0 1 0 2.3l-4.5 4.5a1.6 1.6 0 0 1-2.3 0L4.4 11.2a1.6 1.6 0 0 1 0-2.3l4.5-4.5a1.6 1.6 0 0 1 2.3 0Z"
      fill={STROKE}
      opacity="0.18"
    />
    <path
      d="M11.2 4.4 27 20.2a1.6 1.6 0 0 1 0 2.3l-4.5 4.5a1.6 1.6 0 0 1-2.3 0L4.4 11.2a1.6 1.6 0 0 1 0-2.3l4.5-4.5a1.6 1.6 0 0 1 2.3 0Z"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <path d="M8.4 15.6 15.6 8.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".7" />
    <path d="M18 20c1.6 2 2.4 3.3 2.4 4.4a2.4 2.4 0 0 1-4.8 0c0-1.1.8-2.4 2.4-4.4Z" fill={STROKE} />
  </IconShell>
);

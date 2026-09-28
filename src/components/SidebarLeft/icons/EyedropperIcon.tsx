import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/** Photoshop's Eyedropper: a glass pipette lifting a bead off the canvas. */
export const EyedropperIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="m18.2 4.4 9.4 9.4a1.7 1.7 0 0 1 0 2.4l-2 2-9.4-9.4 2-2a1.7 1.7 0 0 1 0 0Z"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <path d="m16.2 8.4-11 11V27h7.6l11-11" fill={STROKE} opacity="0.18" />
    <path d="m16.2 8.4-11 11V27h7.6l11-11" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    <path d="m12.4 12.2 7.4 7.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".7" />
    <circle cx="26" cy="24" r="3" fill={STROKE} opacity=".8" />
  </IconShell>
);

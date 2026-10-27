import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * Photoshop's Hand: an open palm, fingers up, thumb to the left.
 *
 * Drawn as stroked digits over a filled palm rather than as one filled outline, because at the
 * 28px the rail renders it the gaps between the fingers are what make it read as a HAND at all
 * — a solid mitten shape is indistinguishable from a glove or a blob. The four fingers sit at
 * a 3.2px pitch with a 2px stroke, which leaves a 1.2px gap that survives the downscale.
 *
 * `DragHandleIcon` is NOT an acceptable substitute: it is a grip of dots that happens to set
 * `cursor: grab`, which is a different object with a different job. Reusing it here would put
 * a "drag me" affordance on the tool that drags the view rather than the layer.
 */
export const HandIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    {/* Palm. Closed, so the fill has a shape to sit inside and the outline reads as one edge. */}
    <path d="M9.6 14.6v6.6a5.8 5.8 0 0 0 5.8 5.8h1.2a5.8 5.8 0 0 0 5.8-5.8v-6.6Z" fill={STROKE} opacity="0.16" />
    <path
      d="M9.6 14.6v6.6a5.8 5.8 0 0 0 5.8 5.8h1.2a5.8 5.8 0 0 0 5.8-5.8v-6.6"
      stroke={STROKE}
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    {/* Four fingers. Their lower ends are inside the palm, so the palm's top edge cuts them off
        and they read as digits rather than as four loose sticks. */}
    <path
      d="M11.7 16.4V9.6M14.9 16.4V6.6M18.1 16.4V8.4M21.3 16.4V10.9"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="2"
    />
    {/* Thumb, angled off the palm rather than vertical with the fingers. */}
    <path d="M9.6 17.4 6.9 13.6" stroke={STROKE} strokeLinecap="round" strokeWidth="2" />
  </IconShell>
);

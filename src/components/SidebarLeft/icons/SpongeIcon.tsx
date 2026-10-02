import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

/**
 * The Sponge: a droplet over a wash, which is what the tool does to a colour.
 *
 * It shares the Dodge and the Burn's disc-and-rays frame on purpose. The three share one
 * flyout tile, and a reader who has learned that the frame means "toning" should not have
 * to re-learn it for the third member. What changes inside the frame is the subject: the
 * Dodge and the Burn put a solid disc at the centre of a ring, because they act on
 * lightness and a ring is the range. The Sponge acts on saturation, so it gets a droplet
 * and a spreading wash instead — the one mark in this family that is about colour rather
 * than tone.
 */
export const SpongeIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    <path
      d="M16 4.5c2.1 2.9 4.6 5.4 4.6 8.6a4.6 4.6 0 0 1-9.2 0c0-3.2 2.5-5.7 4.6-8.6Z"
      fill={STROKE}
      fillOpacity=".12"
      stroke={STROKE}
      strokeWidth="1.9"
    />
    <path
      d="M8 25.5c1.6-1.5 3-1.5 4.6 0s3 1.5 4.6 0 3-1.5 4.6 0"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.7"
    />
    <path d="M5.5 21c1-1 2-1 3 0M23.5 21c1-1 2-1 3 0" stroke={STROKE} strokeLinecap="round" strokeWidth="1.4" />
  </IconShell>
);

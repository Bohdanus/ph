import type { ToolIconProps } from '../types';

import { IconShell, STROKE } from './IconShell';

const BANDS = 4;
const BAND_WIDTH = 22 / BANDS;

export const GradientIcon = ({ title }: ToolIconProps) => (
  <IconShell title={title}>
    {Array.from({ length: BANDS }, (_band, index) => (
      <rect
        key={index}
        x={5 + index * BAND_WIDTH}
        y="10"
        width={BAND_WIDTH + 0.4}
        height="12"
        fill={STROKE}
        opacity={(index + 1) / (BANDS + 1)}
      />
    ))}
    <rect x="5" y="10" width="22" height="12" stroke={STROKE} strokeWidth="1.9" />
  </IconShell>
);

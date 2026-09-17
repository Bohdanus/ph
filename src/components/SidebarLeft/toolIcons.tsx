import type { ReactElement, ReactNode } from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';

type ToolIconProps = {
  title: string;
};

type SvgIconFactory = (props: ToolIconProps) => ReactElement;
export type ToolIconName = ToolName | `shape-${'rectangle' | 'oval' | 'square' | 'circle' | 'line'}`;

const SVG_CLASS_NAME = 'h-7 w-7 overflow-visible';
const STROKE = 'currentColor';

const IconShell = ({ children, title }: ToolIconProps & { children: ReactNode }) => (
  <svg
    aria-hidden="true"
    className={SVG_CLASS_NAME}
    fill="none"
    focusable="false"
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>{title}</title>
    {children}
  </svg>
);

// The toolbar uses the same visual language as Photoshop's compact toolbar:
// mostly solid silhouettes, short strokes, and no tool-specific color coding.
const MoveIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M16 3.5v25M3.5 16h25" stroke={STROKE} strokeLinecap="round" strokeWidth="2.1" />
    <path
      d="m16 3.5-4.1 4.1h8.2L16 3.5ZM16 28.5l4.1-4.1h-8.2l4.1 4.1ZM3.5 16l4.1-4.1v8.2L3.5 16ZM28.5 16l-4.1 4.1v-8.2l4.1 4.1Z"
      fill={STROKE}
    />
  </IconShell>
);

const ColorIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="5" y="4" width="16" height="16" fill="white" stroke={STROKE} strokeWidth="1.8" />
    <rect x="11" y="12" width="16" height="16" fill="black" stroke={STROKE} strokeWidth="1.8" />
    <path d="m25 4 3 3M25 7l3-3" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

const BlurIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M16 3.5s8 9.3 8 15a8 8 0 1 1-16 0c0-5.7 8-15 8-15Z" fill={STROKE} opacity=".22" />
    <path d="M16 3.5s8 9.3 8 15a8 8 0 1 1-16 0c0-5.7 8-15 8-15Z" stroke={STROKE} strokeWidth="1.8" />
    <path d="M11.5 18.5c.4 2.2 1.8 3.8 4 4.4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".65" />
    <circle cx="20" cy="17" r="1.2" fill={STROKE} opacity=".55" />
  </IconShell>
);

const LevelsIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M4 26.5h24" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
    <path d="M6 24V18h3v6M11 24V11h3v13M16 24V7h3v17M21 24v-9h3v9M26 24v-4h1v4" fill={STROKE} />
    <path d="M6 7v2M16 4v2M26 7v2" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

const TransformIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="8" y="8" width="16" height="16" stroke={STROKE} strokeWidth="1.8" />
    <path
      d="M5 11V5h6M21 5h6v6M27 21v6h-6M11 27H5v-6"
      stroke={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.1"
    />
    <path
      d="m5 5 4 4M27 5l-4 4M27 27l-4-4M5 27l4-4"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.4"
      opacity=".7"
    />
  </IconShell>
);

const CropIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M10 4v18h18M4 10h18v18" stroke={STROKE} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    <path d="M10 10h12v12H10z" fill={STROKE} opacity=".12" />
    <path d="M7 7h6M7 7v6M25 25h-6M25 25v-6" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" opacity=".7" />
  </IconShell>
);

const DrawIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="m7 25 13.8-13.8 4 4L11 29H7v-4Z" fill={STROKE} opacity=".2" />
    <path d="m7 25 13.8-13.8 4 4L11 29H7v-4Z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    <path d="m20.8 11.2 3.5-3.5 4 4-3.5 3.5-4-4Z" fill={STROKE} />
    <path
      d="M8.5 8.5c2.6 0 2.6 3.5 5.2 3.5s2.6-3.5 5.2-3.5"
      stroke={STROKE}
      strokeLinecap="round"
      strokeWidth="1.5"
      opacity=".7"
    />
  </IconShell>
);

const ShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M5 7h12v10H5z" fill={STROKE} opacity=".16" stroke={STROKE} strokeWidth="1.8" />
    <circle cx="21.5" cy="21" r="6.5" fill={STROKE} opacity=".25" stroke={STROKE} strokeWidth="1.8" />
    <path d="m12 27-4-6-4 6h8Z" fill={STROKE} opacity=".8" />
  </IconShell>
);

const RectangleShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="6" y="7" width="20" height="18" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

const EllipseShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <ellipse cx="16" cy="16" rx="11" ry="8.5" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

const SquareShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="7" y="7" width="18" height="18" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

const CircleShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" r="9" fill={STROKE} opacity=".14" stroke={STROKE} strokeWidth="1.8" />
  </IconShell>
);

const LineShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="m6 26 20-20" stroke={STROKE} strokeLinecap="round" strokeWidth="2.2" />
    <path d="m6 26 4-1M6 26l1-4M26 6l-4 1M26 6l-1 4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

const TextIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M5 5h22v4M16 5v22M11 27h10" stroke={STROKE} strokeLinecap="round" strokeWidth="2.3" />
    <path d="M8 9h16" stroke={STROKE} strokeLinecap="round" strokeWidth="1.3" opacity=".55" />
  </IconShell>
);

const FreehandLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path
      d="M7 17c-1.7-5.6 5.4-10.9 12.8-8.4 6.9 2.3 6.8 9.5 1.2 13.1-5.2 3.4-13.3 1.9-14-2.4Z"
      stroke={STROKE}
      strokeDasharray="2.5 1.8"
      strokeLinecap="round"
      strokeWidth="2"
    />
    <path d="M19.5 21.8c1.8 1.6 3.5 3.2 5.6 5.7" stroke={STROKE} strokeLinecap="round" strokeWidth="2.1" />
    <circle cx="19.5" cy="21.8" r="1.8" fill={STROKE} />
  </IconShell>
);

const PolygonalLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="m6 21 5-13 14 4 1 10-11 5-9-6Z" stroke={STROKE} strokeLinejoin="round" strokeWidth="1.8" />
    <path d="m6 21 5-13 14 4" stroke={STROKE} strokeDasharray="2 1.5" strokeWidth="1.2" opacity=".6" />
    <circle cx="6" cy="21" r="2" fill={STROKE} />
    <path d="m15 27 8 1" stroke={STROKE} strokeLinecap="round" strokeWidth="1.8" />
  </IconShell>
);

const FeatherMagneticLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path
      d="M7 17c-1.1-5.5 5.7-10.4 12.5-8.3 6.3 2 6.7 8.9 1.4 12.5-5.4 3.7-12.9 2.3-13.9-1.7Z"
      stroke={STROKE}
      strokeDasharray="2.5 1.8"
      strokeLinecap="round"
      strokeWidth="1.9"
    />
    <path d="m19.8 21.5 6 5.8" stroke={STROKE} strokeLinecap="round" strokeWidth="2" />
    <path d="M9 8.5v3M13 6.8v3M17 6.5v3M21 8v3" stroke={STROKE} strokeLinecap="round" strokeWidth="1.5" />
    <circle cx="16" cy="17" r="2" fill={STROKE} />
  </IconShell>
);

const MagicWandIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="m8 25 15-15" stroke={STROKE} strokeLinecap="round" strokeWidth="2.8" />
    <path d="m20.5 7.5 4 4" stroke={STROKE} strokeLinecap="round" strokeWidth="1.7" opacity=".65" />
    <path
      d="m7 5 .9 2.1L10 8l-2.1.9L7 11l-.9-2.1L4 8l2.1-.9L7 5ZM17 3l.8 1.7L19.5 5l-1.7.8L17 7.5l-.8-1.7L14.5 5l1.7-.8L17 3ZM25 19l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7Z"
      fill={STROKE}
    />
  </IconShell>
);

const RectangularSelectionIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="6" y="7" width="20" height="18" fill={STROKE} opacity=".08" />
    <path d="M6 12V7h5M21 7h5v5M26 20v5h-5M11 25H6v-5" stroke={STROKE} strokeDasharray="3 2" strokeWidth="1.9" />
  </IconShell>
);

export const toolIcons = {
  reposition: MoveIcon,
  color: ColorIcon,
  blur: BlurIcon,
  levels: LevelsIcon,
  transform: TransformIcon,
  crop: CropIcon,
  draw: DrawIcon,
  shape: ShapeIcon,
  'shape-rectangle': RectangleShapeIcon,
  'shape-oval': EllipseShapeIcon,
  'shape-square': SquareShapeIcon,
  'shape-circle': CircleShapeIcon,
  'shape-line': LineShapeIcon,
  text: TextIcon,
  'freehand-lasso': FreehandLassoIcon,
  'polygonal-lasso': PolygonalLassoIcon,
  'feather-magnetic-lasso': FeatherMagneticLassoIcon,
  'magic-wand': MagicWandIcon,
  'rectangular-selection': RectangularSelectionIcon,
} satisfies Record<ToolIconName, SvgIconFactory>;

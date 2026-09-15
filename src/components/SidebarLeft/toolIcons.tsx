import type { ReactElement, ReactNode } from 'react';

import type { ToolName } from '../../contexts/tool-types.ts';

type ToolIconProps = {
  title: string;
};

type SvgIconFactory = (props: ToolIconProps) => ReactElement;

const SVG_CLASS_NAME = 'h-7 w-7 overflow-visible';

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

const MoveIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M16 4v24M4 16h24" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    <path d="M16 4l-4 4h8l-4-4ZM16 28l4-4h-8l4 4ZM4 16l4 4v-8l-4 4ZM28 16l-4-4v8l4-4Z" fill="currentColor" />
  </IconShell>
);

const ColorIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <circle cx="16" cy="16" r="10" fill="currentColor" opacity="0.16" stroke="currentColor" strokeWidth="2" />
    <path d="M16 6a10 10 0 0 1 10 10h-10V6Z" fill="#ef4444" />
    <path d="M26 16a10 10 0 0 1-10 10V16h10Z" fill="#22c55e" />
    <path d="M16 26A10 10 0 0 1 6 16h10v10Z" fill="#3b82f6" />
    <path d="M6 16A10 10 0 0 1 16 6v10H6Z" fill="#facc15" />
    <circle cx="16" cy="16" r="3" fill="currentColor" />
  </IconShell>
);

const BlurIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M16 4s8 9 8 15a8 8 0 0 1-16 0c0-6 8-15 8-15Z" fill="currentColor" opacity="0.18" />
    <path d="M16 4s8 9 8 15a8 8 0 0 1-16 0c0-6 8-15 8-15Z" stroke="currentColor" strokeWidth="2" />
    <circle cx="12" cy="20" r="1.5" fill="currentColor" opacity="0.38" />
    <circle cx="17" cy="18" r="1.5" fill="currentColor" opacity="0.48" />
    <circle cx="20" cy="22" r="1.5" fill="currentColor" opacity="0.34" />
  </IconShell>
);

const LevelsIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M5 25h22" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    <path d="M7 23V11M13 23V6M19 23V14M25 23V9" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    <path d="M7 16h4M13 10h4M19 19h4M23 14h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
  </IconShell>
);

const TransformIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="8" y="8" width="16" height="16" stroke="currentColor" strokeWidth="2" />
    <path d="M5 5h7M5 5v7M27 27h-7M27 27v-7" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    <path d="M6 6l6 6M26 26l-6-6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
  </IconShell>
);

const CropIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M10 4v18h18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    <path d="M4 10h18v18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    <path d="M10 10h12v12H10z" fill="currentColor" opacity="0.12" />
  </IconShell>
);

const DrawIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M8 24 21.5 10.5l3 3L11 27H8v-3Z" fill="currentColor" opacity="0.22" />
    <path d="M8 24 21.5 10.5l3 3L11 27H8v-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    <path d="M19.5 8.5 23 5l4 4-3.5 3.5-4-4Z" fill="currentColor" />
    <path d="M5 8c3 0 3 4 6 4s3-4 6-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </IconShell>
);

const ShapeIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect x="5" y="6" width="11" height="11" stroke="currentColor" strokeWidth="2" />
    <circle cx="22" cy="21" r="6" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="2" />
    <path d="M13 25h-7l3.5-6 3.5 6Z" fill="currentColor" />
  </IconShell>
);

const TextIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M6 8V5h20v3M16 5v22M12 27h8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
    <path d="M10 13h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" opacity="0.35" />
  </IconShell>
);

const FreehandLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path
      d="M7 18c-2-7 8-12 16-7 5 3 3 11-3 13-7 2-15-1-13-6Z"
      fill="currentColor"
      opacity="0.14"
      stroke="currentColor"
      strokeDasharray="3 2"
      strokeLinecap="round"
      strokeWidth="2"
    />
    <path d="M19 23l6 5" stroke="currentColor" strokeLinecap="round" strokeWidth="2.3" />
  </IconShell>
);

const PolygonalLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M7 19 11 8l12 3 2 11-10 4-8-7Z" fill="currentColor" opacity="0.12" />
    <path d="M7 19 11 8l12 3 2 11-10 4-8-7Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    <path d="M11 8 25 22M23 11 15 26" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" opacity="0.36" />
  </IconShell>
);

const FeatherMagneticLassoIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path
      d="M8 18c-1-7 8-12 15-7 5 3 4 10-2 13-6 3-14 0-13-6Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
    <path d="M20 23l5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    <path
      d="M10 7v5M14 5v5M18 5v5M22 7v5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
      opacity="0.46"
    />
    <circle cx="16" cy="17" r="2" fill="currentColor" />
  </IconShell>
);

const MagicWandIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <path d="M9 25 24 10" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    <path d="M20.5 7.5 26.5 13.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity="0.55" />
    <path d="M7 7l1.2 2.8L11 11l-2.8 1.2L7 15l-1.2-2.8L3 11l2.8-1.2L7 7Z" fill="currentColor" />
    <path d="M18 3l0.9 2.1L21 6l-2.1 0.9L18 9l-0.9-2.1L15 6l2.1-0.9L18 3Z" fill="currentColor" opacity="0.8" />
    <path d="M25 20l0.9 2.1L28 23l-2.1 0.9L25 26l-0.9-2.1L22 23l2.1-0.9L25 20Z" fill="currentColor" opacity="0.8" />
    <circle cx="14" cy="20" r="3.5" fill="currentColor" opacity="0.13" />
  </IconShell>
);

const RectangularSelectionIcon: SvgIconFactory = ({ title }) => (
  <IconShell title={title}>
    <rect
      x="7"
      y="8"
      width="18"
      height="16"
      fill="currentColor"
      opacity="0.08"
      stroke="currentColor"
      strokeDasharray="3 2"
      strokeWidth="2"
    />
    <path d="M11 12h10v8H11z" stroke="currentColor" strokeWidth="1.4" opacity="0.35" />
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
  text: TextIcon,
  'freehand-lasso': FreehandLassoIcon,
  'polygonal-lasso': PolygonalLassoIcon,
  'feather-magnetic-lasso': FeatherMagneticLassoIcon,
  'magic-wand': MagicWandIcon,
  'rectangular-selection': RectangularSelectionIcon,
} satisfies Record<ToolName, SvgIconFactory>;

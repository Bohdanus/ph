import type { ReactNode } from 'react';

const SVG_CLASS_NAME = 'h-7 w-7 overflow-visible';
const STROKE = 'currentColor';

type IconShellProps = {
  children: ReactNode;
  title: string;
};

export const IconShell = ({ children, title }: IconShellProps) => (
  <svg
    aria-hidden="true"
    className={SVG_CLASS_NAME}
    fill="none"
    focusable="false"
    stroke={STROKE}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={1.8}
    viewBox="0 0 32 32"
    xmlns="http://www.w3.org/2000/svg"
  >
    {title.length > 0 && <title>{title}</title>}
    {children}
  </svg>
);

export { STROKE };

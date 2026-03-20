type Props = {
  disabled?: boolean;
};

export const TrashIcon = ({ disabled }: Props) => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    aria-hidden="true"
    style={{
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.1 : undefined,
    }}
  >
    <path d="M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M10 11v7M14 11v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7 7l1 14h8l1-14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M9 7V4h6v3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

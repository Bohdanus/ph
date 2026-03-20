type Props = {
  disabled?: boolean;
};

export const DragHandleIcon = ({ disabled }: Props) => {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      aria-hidden="true"
      style={{
        cursor: disabled ? 'not-allowed' : 'grab',
        opacity: disabled ? 0.1 : undefined,
      }}
    >
      <path d="M4 7h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

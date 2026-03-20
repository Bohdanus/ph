export const EyeIcon = ({ open }: { open: boolean }) => {
  return open ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M2.3 12s3.3-7 9.7-7 9.7 7 9.7 7-3.3 7-9.7 7S2.3 12 2.3 12Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M2.3 12s3.3-7 9.7-7c2.2 0 4.1.8 5.7 1.9M21.7 12s-3.3 7-9.7 7c-2.2 0-4.1-.8-5.7-1.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M10.2 10.2A3.2 3.2 0 0 0 13.8 13.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

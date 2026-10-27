/**
 * The background icon rendered on a bedrock layer row. A bedrock layer is the
 * document's backing image, and Photoshop renders its Background row with a
 * padlock-style glyph — here a filled rectangle, since `Layer.locked` is a
 * separate field and the panel has no lock icon at all.
 */
export const BedrockIcon = () => {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 13h18" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

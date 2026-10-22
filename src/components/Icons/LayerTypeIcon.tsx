import type { LayerSource } from '@/contexts/layer-types.ts';

/**
 * Auxiliary source glyphs shown beside a layer thumbnail. Type layers use the
 * Photoshop-style T badge inside the thumbnail instead.
 *
 * `isBedrock` layers carry no `source` at all, so they are handled before the
 * source switch and render a separate background glyph.
 */
export const LayerTypeIcon = ({ source }: { source: LayerSource | null | undefined }) => {
  if (!source || source.kind === 'blank') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (source.kind === 'image') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M3 14l5-5 4 4 3-3 7 7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
      </svg>
    );
  }

  if (source.args.toolName === 'text') return null;

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
};

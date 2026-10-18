import { useStore } from '../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../contexts/history-adapter.ts';
import { replayDurableAtCursor } from '../../contexts/durable-replay.ts';

/**
 * A pathological conversion can emit one diagnostic per history entry, and the
 * footer is a one-line strip. Three plus a count is enough to see the shape of
 * a failure without letting a bad document grow the bar without bound.
 */
const VISIBLE_DIAGNOSTICS = 3;
const EMPTY_PRESENTATION = {
  status: 'unpublished' as const,
  cursor: null,
  reason: null,
};

/**
 * The store reader lives in its own component so the DEV gate sits ABOVE the subscription. Vite's
 * `import.meta.env.DEV` substitution removes this component and its store read from production.
 */
const DevStatusStripContents = () => {
  const [
    {
      durableStatus,
      durableDiagnostics,
      durablePresentation: storedPresentation,
      durableDocument,
      documentId,
      documentRevision,
      branchRevision,
      historyIndex,
    },
  ] = useStore();
  const durablePresentation = storedPresentation ?? EMPTY_PRESENTATION;

  // A store slice built by hand can omit the list entirely; treating that as
  // "no diagnostics" keeps the footer renderable instead of throwing while it
  // is reporting a status.
  const diagnostics: readonly MigrationDiagnostic[] = durableDiagnostics ?? [];
  const isPublishedDurable =
    durableStatus === 'current' && durablePresentation.status === 'durable' && durableDocument != null;
  const durablePublication = isPublishedDurable
    ? `${documentId}@rev${documentRevision}.branch${branchRevision}.history${historyIndex}.durable${durableDocument.durableRevision}`
    : '';
  const durableLayerIds = (() => {
    if (!isPublishedDurable || durablePresentation.cursor === null) return '';
    const replay = replayDurableAtCursor(durableDocument, durablePresentation.cursor);
    return Object.values(replay.layers)
      .filter(({ snapshot }) => snapshot.visible)
      .sort((left, right) => left.snapshot.order - right.snapshot.order)
      .map(({ snapshot }) => snapshot.id)
      .join(',');
  })();

  const shown = diagnostics.slice(0, VISIBLE_DIAGNOSTICS);
  const hidden = diagnostics.length - shown.length;

  return (
    <span
      data-testid="dev-status-strip"
      data-status={durableStatus}
      data-presentation-status={durablePresentation.status}
      data-durable-cursor={durablePresentation.cursor ?? ''}
      data-durable-fallback-reason={durablePresentation.reason ?? ''}
      data-durable-fallback-detail={durablePresentation.detail ?? ''}
      data-durable-publication={durablePublication}
      data-durable-layer-ids={durableLayerIds}
      className="text-xs text-amber-800 dark:text-amber-300"
    >
      <span data-testid="dev-status-strip-status">Durable: {durableStatus}</span>
      <span data-testid="dev-status-strip-presentation">
        {' · '}
        {durablePresentation.status === 'durable' ? 'Durable presentation' : 'Legacy presentation'}
      </span>
      {shown.length > 0 && (
        <>
          {' · '}
          <span data-testid="dev-status-strip-diagnostics">
            {shown.map((diagnostic) => diagnostic.code).join(', ')}
            {hidden > 0 ? `, +${hidden} more` : ''}
          </span>
        </>
      )}
    </span>
  );
};

/**
 * The durable shadow has no reader anywhere else in the UI: an
 * `unsupported-history-feature`, a `conversion-failed` or a
 * `durable-append-mismatch` is computed, stored, and never shown
 * (`DurableDocumentStatus` fails closed by design, which means it fails
 * silently). This strip is that reader.
 *
 * Dev-only: it is diagnostic, not a user-facing surface, and the codes it
 * prints are internal to the migration. The gate is on this component and not on
 * the store reader, so "dev-only" also means "never subscribed in production".
 */
const DevStatusStrip = () => (import.meta.env.DEV ? <DevStatusStripContents /> : null);

export default DevStatusStrip;

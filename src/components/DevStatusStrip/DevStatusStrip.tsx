import { useStore } from '../../contexts/StoreContext.tsx';
import type { MigrationDiagnostic } from '../../contexts/history-adapter.ts';

/**
 * A pathological conversion can emit one diagnostic per history entry, and the
 * footer is a one-line strip. Three plus a count is enough to see the shape of
 * a failure without letting a bad document grow the bar without bound.
 */
const VISIBLE_DIAGNOSTICS = 3;

/**
 * The store reader, in a component of its own so the DEV gate can sit ABOVE the subscription. With
 * the guard below `useStore()`, Vite's `import.meta.env.DEV` substitution removes the rendered
 * output and keeps the call: a production bundle then re-renders this on every store transition to
 * return `null`, still holding a live subscription to the durable shadow.
 */
const DevStatusStripContents = () => {
  const [{ durableStatus, durableDiagnostics }] = useStore();

  // A store slice built by hand can omit the list entirely; treating that as
  // "no diagnostics" keeps the footer renderable instead of throwing while it
  // is reporting a status.
  const diagnostics: readonly MigrationDiagnostic[] = durableDiagnostics ?? [];
  // `current` with a warning is still a real state, so the status alone cannot
  // decide whether there is anything to say.
  if (durableStatus === 'current' && diagnostics.length === 0) return null;

  const shown = diagnostics.slice(0, VISIBLE_DIAGNOSTICS);
  const hidden = diagnostics.length - shown.length;

  return (
    <span
      data-testid="dev-status-strip"
      data-status={durableStatus}
      className="text-xs text-amber-600 dark:text-amber-400"
    >
      <span data-testid="dev-status-strip-status">Durable: {durableStatus}</span>
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

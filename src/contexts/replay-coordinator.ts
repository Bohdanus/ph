export type ReplayRevisionToken = Readonly<{
  documentId: string;
  documentRevision: number;
  durableRevision: number;
  branchRevision: number;
  cursor: number;
  baselineAssetGeneration: number;
  operationSetRevision: number;
  sourceGeneration?: number;
}>;

export type ReplayCoordinatorState =
  'idle' | 'requested' | 'materializing' | 'publishable' | 'published' | 'cancelled' | 'stale' | 'failed';

export type ReplayRequestOutcome<T> = Readonly<{
  requestId: number;
  state: Exclude<ReplayCoordinatorState, 'idle' | 'requested' | 'materializing' | 'publishable'>;
  result?: T;
  error?: unknown;
}>;

export type ReplayRequest<T> = Readonly<{
  token: ReplayRevisionToken;
  signal?: AbortSignal;
  isStillValid?: (token: ReplayRevisionToken) => boolean;
  materialize: (
    input: Readonly<{ signal: AbortSignal; requestId: number; yieldToHost: () => Promise<void> }>
  ) => Promise<T>;
  publish: (result: T, token: ReplayRevisionToken) => void;
  release?: (result: T) => void;
  onStateChange?: (state: ReplayCoordinatorState, requestId: number) => void;
}>;

function sameToken(left: ReplayRevisionToken, right: ReplayRevisionToken): boolean {
  return (
    left.documentId === right.documentId &&
    left.documentRevision === right.documentRevision &&
    left.durableRevision === right.durableRevision &&
    left.branchRevision === right.branchRevision &&
    left.cursor === right.cursor &&
    left.baselineAssetGeneration === right.baselineAssetGeneration &&
    left.operationSetRevision === right.operationSetRevision &&
    left.sourceGeneration === right.sourceGeneration
  );
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    const frameAvailable =
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function' &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden');
    if (!frameAvailable) {
      setTimeout(resolve, 0);
      return;
    }
    let settled = false;
    const fallback = { id: undefined as number | undefined };
    const finish = () => {
      if (settled) return;
      settled = true;
      if (fallback.id !== undefined) window.clearTimeout(fallback.id);
      resolve();
    };
    fallback.id = window.setTimeout(finish, 100);
    window.requestAnimationFrame(finish);
  });
}

/**
 * Coordinates async materialization without owning StoreContext. The caller
 * supplies a token snapshot and a validity function backed by the current
 * durable document. Cancellation is advisory; token checks remain mandatory.
 *
 * Phase 1 status: dormant. No production path mounts a coordinator, no store
 * action publishes a materialized replay, and this module must not be imported
 * by a navigation or rendering path while the legacy runtime stays
 * authoritative.
 *
 * Phase 4 requirements before the first production request:
 *
 * - the request must carry a complete token: document id, document revision,
 *   branch revision, durable revision, cursor, baseline asset generation,
 *   operation-set revision, source generation, and frame revision when output
 *   is frame-relative;
 * - `isStillValid` must be backed by live StoreContext state and compared
 *   against a freshly read token immediately before `publish`, never against the
 *   request-time snapshot;
 * - every unpublished result must release its leases and temporary bitmaps
 *   exactly once, including the stale, cancelled, and thrown paths;
 * - one coordinator instance per live document, cancelled on document
 *   replacement.
 */
export class ReplayCoordinator<T> {
  private requestSequence = 0;
  private current?: { requestId: number; token: ReplayRevisionToken; controller: AbortController };

  get currentRequestId(): number {
    return this.current?.requestId ?? 0;
  }

  cancel(): void {
    const current = this.current;
    if (!current) return;
    current.controller.abort();
    this.current = undefined;
  }

  isCurrent(requestId: number, isStillValid?: (token: ReplayRevisionToken) => boolean): boolean {
    const current = this.current;
    if (!current || current.requestId !== requestId) return false;
    // A request token is an immutable start snapshot. Only a fresh token
    // supplied by the StoreContext-backed callback can prove it is current.
    // A request ID only establishes ordering, not document freshness. Future
    // production callers must provide a live StoreContext-backed validator.
    return isStillValid ? !!isStillValid(current.token) : false;
  }

  async request(input: ReplayRequest<T>): Promise<ReplayRequestOutcome<T>> {
    this.cancel();
    const requestId = ++this.requestSequence;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    if (input.signal?.aborted) controller.abort();
    this.current = { requestId, token: { ...input.token }, controller };
    const state = (next: ReplayCoordinatorState) => input.onStateChange?.(next, requestId);
    state('requested');
    let result: T | undefined;
    let materialized = false;
    let published = false;
    try {
      if (controller.signal.aborted) {
        state('cancelled');
        return { requestId, state: 'cancelled' };
      }
      state('materializing');
      result = await input.materialize({ signal: controller.signal, requestId, yieldToHost });
      materialized = true;
      if (controller.signal.aborted || !this.isCurrent(requestId, input.isStillValid)) {
        input.release?.(result);
        state(controller.signal.aborted ? 'cancelled' : 'stale');
        return { requestId, state: controller.signal.aborted ? 'cancelled' : 'stale' };
      }
      state('publishable');
      // Re-check immediately before the only publication callback.
      if (controller.signal.aborted || !this.isCurrent(requestId, input.isStillValid)) {
        input.release?.(result);
        state(controller.signal.aborted ? 'cancelled' : 'stale');
        return { requestId, state: controller.signal.aborted ? 'cancelled' : 'stale' };
      }
      input.publish(result, input.token);
      published = true;
      state('published');
      return { requestId, state: 'published', result };
    } catch (error) {
      if (!published && materialized) input.release?.(result as T);
      if (controller.signal.aborted) {
        state('cancelled');
        return { requestId, state: 'cancelled', error };
      }
      state('failed');
      return { requestId, state: 'failed', error };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      if (this.current?.requestId === requestId) this.current = undefined;
    }
  }
}

export { sameToken as replayTokensEqual, yieldToHost };

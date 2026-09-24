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
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Coordinates async materialization without owning StoreContext. The caller
 * supplies a token snapshot and a validity function backed by the current
 * durable document. Cancellation is advisory; token checks remain mandatory.
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

  isCurrent(
    requestId: number,
    token: ReplayRevisionToken,
    isStillValid?: (token: ReplayRevisionToken) => boolean
  ): boolean {
    const current = this.current;
    return (
      !!current &&
      current.requestId === requestId &&
      sameToken(current.token, token) &&
      (isStillValid ? isStillValid(token) : true)
    );
  }

  async request(input: ReplayRequest<T>): Promise<ReplayRequestOutcome<T>> {
    this.cancel();
    const requestId = ++this.requestSequence;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    this.current = { requestId, token: { ...input.token }, controller };
    const state = (next: ReplayCoordinatorState) => input.onStateChange?.(next, requestId);
    state('requested');
    let result: T | undefined;
    let materialized = false;
    let published = false;
    try {
      state('materializing');
      result = await input.materialize({ signal: controller.signal, requestId, yieldToHost });
      materialized = true;
      if (controller.signal.aborted || !this.isCurrent(requestId, input.token, input.isStillValid)) {
        input.release?.(result);
        state(controller.signal.aborted ? 'cancelled' : 'stale');
        return { requestId, state: controller.signal.aborted ? 'cancelled' : 'stale' };
      }
      state('publishable');
      // Re-check immediately before the only publication callback.
      if (controller.signal.aborted || !this.isCurrent(requestId, input.token, input.isStillValid)) {
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

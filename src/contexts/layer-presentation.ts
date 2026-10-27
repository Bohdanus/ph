import { isEqual } from 'lodash-es';

import type { BitmapSource } from './general-types.ts';
import type { Layer, LayerId, LayerSource, LayersRecord } from './layer-types.ts';
import { isIdentityAffineTransform } from './affine-transform.ts';

/**
 * A request to promote a disposable presentation canvas into the published
 * runtime layer. `canvas` is the identity token: the promotion is refused
 * unless the layer still holds that exact canvas when the bitmap arrives, which
 * is also what keeps a promotion inside the document that published the canvas.
 */
export type LayerPresentationRequest = Readonly<{
  layerId: LayerId;
  canvas: BitmapSource;
}>;

/** Typed promotion payload. Only the dispatcher may construct this. */
export type LayerPresentationPromotion = LayerPresentationRequest &
  Readonly<{
    bitmap: BitmapSource;
  }>;

/**
 * One publication for every promotion a single commit produced, so a commit that
 * dirties several layers costs one store transition instead of one per layer.
 */
export type LayerPresentationBatch = Readonly<{
  promotions: readonly LayerPresentationPromotion[];
}>;

function isOwnedPresentationBitmap(bitmap: BitmapSource): bitmap is ImageBitmap {
  return typeof (bitmap as { close?: unknown }).close === 'function';
}

/**
 * Closes a presentation bitmap. Only bitmaps this boundary created itself may be
 * closed here: they are immutable ImageBitmaps with no registry record, no
 * lease, and no other owner. A borrowed raster from an import or a replay is
 * never owned here and is never passed in.
 */
export function closePresentationBitmap(bitmap: BitmapSource): void {
  if (isOwnedPresentationBitmap(bitmap)) bitmap.close();
}

export function isSamePresentationCanvas(layer: Layer | undefined, canvas: BitmapSource | null | undefined): boolean {
  return !!layer && !!canvas && layer.tmpCanvas === canvas;
}

/**
 * The single presentation-cache materialization path. A failure is contained
 * here so the caller keeps the source canvas and the layer stays renderable.
 */
export function materializePresentationBitmap(canvas: BitmapSource): Promise<BitmapSource | undefined> {
  const create = globalThis.createImageBitmap;
  if (!create) {
    return Promise.reject(new Error('createImageBitmap is required to promote a layer presentation'));
  }

  return create(canvas as CanvasImageSource).catch((error) => {
    console.error('Unable to materialize layer presentation cache', error);
    return undefined;
  });
}

/**
 * The only fields a promotion may change. Naming them keeps every other layer
 * field in scope automatically, so a newly added logical field is compared
 * instead of silently excluded from the guard.
 */
const PRESENTATION_FIELDS: (keyof Layer)[] = ['bitmap', 'tmpCanvas', 'presentationBounds'];

/**
 * Everything a layer owns except the presentation cache fields. Reading the keys
 * rather than naming them keeps every current and future durable field in scope.
 */
function logicalLayerState(layer: Layer): Record<string, unknown> {
  return Object.fromEntries(Object.entries(layer).filter(([key]) => !PRESENTATION_FIELDS.includes(key as never)));
}

function isSameSource(left: LayerSource | undefined, right: LayerSource | undefined): boolean {
  if (left === right) return true;
  // A raster source aliases an imported bitmap by reference. Two different
  // bitmap objects are a different source even when they look identical.
  if (left?.kind === 'image' || right?.kind === 'image') return false;
  return isEqual(left, right);
}

/**
 * Proves that publishing `next` changes only disposable presentation state.
 *
 * `bitmap` and `tmpCanvas` are caches: a promotion may replace them without
 * recording history. Everything else is durable logical state, so a publication
 * that also changes it is not a presentation update. The comparison fails
 * closed: an unexpected value shape is a difference, never a match.
 */
export function layersDifferOnlyByPresentation(current: LayersRecord, next: LayersRecord): boolean {
  const currentIds = Object.keys(current);
  const nextIds = Object.keys(next);
  if (currentIds.length !== nextIds.length) return false;
  return nextIds.every((id) => {
    const previous = current[id];
    const candidate = next[id];
    if (!previous || !candidate) return false;
    // An untouched layer is the common case: one identity check replaces two
    // record allocations plus a walk.
    if (previous === candidate) return true;
    return (
      isEqual(logicalLayerState(previous), logicalLayerState(candidate)) &&
      isSameSource(previous.source, candidate.source)
    );
  });
}

/**
 * Proves that publishing `next` changes only disposable presentation state
 * and/or identity affine-transform operations.
 *
 * This is a stricter check than `layersDifferOnlyByPresentation`: it allows
 * `operations` to differ only by identity affine-transform entries (where
 * `kind === 'affine-transform' && isIdentityAffineTransform(op.transform)`).
 * Both sides are filtered to remove identity affine operations before comparison,
 * since `createAffineLayerOperation` mints fresh UUIDs per preview.
 *
 * The comparison fails closed: an unexpected value shape is a difference, never a match.
 */
export function layersDifferOnlyByPresentationAndIdentityAffine(current: LayersRecord, next: LayersRecord): boolean {
  const currentIds = Object.keys(current);
  const nextIds = Object.keys(next);
  if (currentIds.length !== nextIds.length) return false;
  return nextIds.every((id) => {
    const previous = current[id];
    const candidate = next[id];
    if (!previous || !candidate) return false;
    // An untouched layer is the common case: one identity check replaces two
    // record allocations plus a walk.
    if (previous === candidate) return true;
    // Filter identity affine operations from both sides before comparing.
    const previousOps = (previous.operations ?? []).filter(
      (op) => !(op.kind === 'affine-transform' && isIdentityAffineTransform(op.transform))
    );
    const candidateOps = (candidate.operations ?? []).filter(
      (op) => !(op.kind === 'affine-transform' && isIdentityAffineTransform(op.transform))
    );
    const previousState = { ...logicalLayerState(previous), operations: previousOps };
    const candidateState = { ...logicalLayerState(candidate), operations: candidateOps };
    return isEqual(previousState, candidateState) && isSameSource(previous.source, candidate.source);
  });
}

/**
 * Owner of every presentation bitmap the store materializes.
 *
 * Ownership has exactly one holder at each step, and every exit is closed:
 *
 * - in flight: this scope, which closes the bitmap if the provider is torn down
 *   before it can be published;
 * - refused because the requesting canvas is no longer the layer's canvas: the
 *   dispatcher, which closes it;
 * - published: the store layer, with the scope keeping the reference so a cache
 *   the record replaces or stops naming, and a departing document, can close it
 *   deterministically.
 *
 * The scope is deliberately provider-scoped rather than document-scoped: a
 * document replacement commits in the same turn as a promotion requested just
 * before it, so a per-document scope would dispose a bitmap the new document
 * legitimately owns. The document boundary is instead enforced by the canvas
 * identity token, which no layer of another document can hold, and a departing
 * document's caches are released explicitly.
 */
export class DocumentPresentationScope {
  private readonly published = new Map<string, Set<BitmapSource>>();
  private readonly leases = new Map<string, Map<BitmapSource, Set<() => void>>>();
  private disposed = false;

  /** Records a bitmap the store just published, keyed by owning document. */
  trackPublished(documentId: string, bitmap: BitmapSource): void {
    if (this.disposed) {
      closePresentationBitmap(bitmap);
      return;
    }
    const owned = this.published.get(documentId) ?? new Set<BitmapSource>();
    owned.add(bitmap);
    this.published.set(documentId, owned);
  }

  /** Records a materialization lease alongside its presentation bitmap. */
  trackPublishedLease(documentId: string, bitmap: BitmapSource, release: () => void): void {
    if (this.disposed) {
      release();
      return;
    }
    this.trackPublished(documentId, bitmap);
    const documentLeases = this.leases.get(documentId) ?? new Map<BitmapSource, Set<() => void>>();
    const bitmapLeases = documentLeases.get(bitmap) ?? new Set<() => void>();
    bitmapLeases.add(release);
    documentLeases.set(bitmap, bitmapLeases);
    this.leases.set(documentId, documentLeases);
  }

  /**
   * Closes every cache this scope published for `documentId` that nothing names.
   *
   * Candidacy is the scope's own published set, NOT the previous layer record.
   * A raster can leave the store's reach without ever having been
   * `previous[].bitmap` in the transition that drops it — an import whose layer
   * is replaced, or a merge whose history entry the next append truncates — and
   * deriving candidates from a record misses exactly those, leaking a
   * full-document `ImageBitmap` until the document changes.
   *
   * `live` is the caller's, because only the store knows every alias a raster
   * has: the layer's own `bitmap`, the `source` object stored verbatim on the
   * layer, and the `layerSource`/`args` reference a history entry retains, which
   * `history-replay` reads back on undo. Closing one of those is a
   * use-after-close on the production replay authority, not a leak.
   *
   * It is a THUNK, and it has to stay one. Answering that question walks the whole
   * unbounded history and every alias in it, so as a value it would be computed on
   * every commit, undo, redo and layer mutation — while a document the scope has
   * published nothing for cannot retire anything, whatever the answer says. The
   * early-out below is the only thing that makes the walk affordable, so the walk
   * stays behind it: a caller that passes an eagerly built set reintroduces the
   * cost on the path this early-out exists to skip, and no signature can catch it.
   */
  retireUnreferenced(documentId: string, live: () => ReadonlySet<BitmapSource>): void {
    const owned = this.published.get(documentId);
    if (!owned) return;
    const reachable = live();
    const departed = [...owned].filter((bitmap) => !reachable.has(bitmap));
    if (!departed.length) return;
    for (const bitmap of departed) owned.delete(bitmap);
    const documentLeases = this.leases.get(documentId);
    if (!owned.size) this.published.delete(documentId);
    if (documentLeases && !owned.size) this.leases.delete(documentId);
    for (const bitmap of departed) {
      const releases = documentLeases?.get(bitmap);
      documentLeases?.delete(bitmap);
      if (releases) for (const release of releases) release();
      else closePresentationBitmap(bitmap);
    }
  }

  /** Closes every published cache of a document that is being replaced. */
  releaseDocument(documentId: string): void {
    const owned = this.published.get(documentId);
    if (!owned) return;
    this.published.delete(documentId);
    const documentLeases = this.leases.get(documentId);
    this.leases.delete(documentId);
    for (const bitmap of owned) {
      const releases = documentLeases?.get(bitmap);
      if (releases) for (const release of releases) release();
      else closePresentationBitmap(bitmap);
    }
  }

  /**
   * Hands a materialized bitmap to the store only while the provider is live. A
   * result that arrives after teardown is closed here instead.
   */
  deliver(task: Promise<BitmapSource | undefined>, publish: (bitmap: BitmapSource) => void): void {
    void task.then(
      (bitmap) => {
        if (!bitmap) return;
        if (this.disposed) {
          closePresentationBitmap(bitmap);
          return;
        }
        publish(bitmap);
      },
      (error) => {
        console.error('Unable to request a layer presentation promotion', error);
      }
    );
  }

  /**
   * Batch form of `deliver`, so a commit that dirties several layers publishes
   * one store transition. Every bitmap that survives teardown is closed here.
   */
  deliverBatch(
    task: Promise<readonly (BitmapSource | undefined)[]>,
    publish: (bitmaps: readonly (BitmapSource | undefined)[]) => void
  ): void {
    void task.then(
      (bitmaps) => {
        if (this.disposed) {
          for (const bitmap of bitmaps) {
            if (bitmap) closePresentationBitmap(bitmap);
          }
          return;
        }
        publish(bitmaps);
      },
      (error) => {
        console.error('Unable to request a layer presentation promotion', error);
      }
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [documentId, owned] of this.published) {
      const documentLeases = this.leases.get(documentId);
      for (const bitmap of owned) {
        const releases = documentLeases?.get(bitmap);
        if (releases) for (const release of releases) release();
        else closePresentationBitmap(bitmap);
      }
    }
    this.published.clear();
    this.leases.clear();
  }
}

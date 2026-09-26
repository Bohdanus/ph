import { v4 as uuidv4 } from 'uuid';

import type { AssetId } from './history-model.ts';
import type { BitmapSource } from './general-types.ts';

export type AssetOwnership = 'adopt' | 'borrow';

export type AssetRecord = Readonly<{
  id: AssetId;
  documentId: string;
  generation: number;
  width: number;
  height: number;
  byteSize: number;
  sourceType: 'image-bitmap' | 'html-image' | 'html-canvas' | 'offscreen-canvas' | 'unknown';
  ownership: AssetOwnership;
  disposed: boolean;
}>;

export type AssetLease = Readonly<{
  assetId: AssetId;
  generation: number;
  bitmap: BitmapSource;
  record: AssetRecord;
  release: () => void;
}>;

export type MaterializationLease<Metadata = undefined> = Readonly<{
  key: string;
  bitmap: BitmapSource;
  byteSize: number;
  metadata: Metadata;
  release: () => void;
}>;

export type DocumentAssetTransaction = Readonly<{
  commit: () => void;
  rollback: () => void;
}>;

type AssetEntry = {
  record: AssetRecord;
  bitmap: BitmapSource;
  baselineDocuments: Set<string>;
  retainCount: number;
  disposed: boolean;
};

type CacheEntry = {
  key: string;
  documentId?: string;
  bitmap: BitmapSource;
  byteSize: number;
  metadata: unknown;
  retainCount: number;
  lastUsed: number;
  invalidated: boolean;
};

type MaterializationResult<Metadata> = Readonly<{
  bitmap: BitmapSource;
  metadata: Metadata;
}>;

export type AssetRegistryOptions = Readonly<{
  maxCacheBytes?: number;
  maxCacheEntries?: number;
}>;

const DEFAULT_MAX_CACHE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CACHE_ENTRIES = 64;

function bitmapDimension(bitmap: BitmapSource, dimension: 'width' | 'height'): number {
  const value = bitmap[dimension];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1;
}

function sourceType(bitmap: BitmapSource): AssetRecord['sourceType'] {
  if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) return 'image-bitmap';
  if (typeof HTMLImageElement !== 'undefined' && bitmap instanceof HTMLImageElement) return 'html-image';
  if (typeof HTMLCanvasElement !== 'undefined' && bitmap instanceof HTMLCanvasElement) return 'html-canvas';
  if (typeof OffscreenCanvas !== 'undefined' && bitmap instanceof OffscreenCanvas) return 'offscreen-canvas';
  return typeof (bitmap as { close?: unknown }).close === 'function' ? 'image-bitmap' : 'unknown';
}

function isOwnedImageBitmap(bitmap: BitmapSource): bitmap is ImageBitmap {
  return typeof (bitmap as { close?: unknown }).close === 'function';
}

function disposeOwnedBitmap(bitmap: BitmapSource) {
  if (isOwnedImageBitmap(bitmap)) bitmap.close();
}

function immutableRasterCopy(bitmap: BitmapSource): BitmapSource {
  const width = bitmapDimension(bitmap, 'width');
  const height = bitmapDimension(bitmap, 'height');
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is required to synchronously register a mutable raster source');
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required to register a mutable raster source');
  context.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);
  if (typeof canvas.transferToImageBitmap !== 'function') {
    throw new Error('transferToImageBitmap is required to synchronously register a mutable raster source');
  }
  return canvas.transferToImageBitmap();
}

/**
 * Runtime-only owner for external raster data and derived materializations.
 *
 * `registerBaseline` accepts an ImageBitmap or snapshots a mutable drawable
 * into a registry-owned immutable ImageBitmap before assigning an AssetId.
 */
export class AssetRegistry {
  private readonly assets = new Map<AssetId, AssetEntry>();
  private readonly externalIds = new WeakMap<object, AssetId>();
  private readonly documentGenerations = new Map<string, number>();
  private readonly disposedDocuments = new Set<string>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pendingMaterializations = new Map<string, Promise<CacheEntry>>();
  private cacheBytes = 0;
  private clock = 0;
  private readonly maxCacheBytes: number;
  private readonly maxCacheEntries: number;

  constructor(options: AssetRegistryOptions = {}) {
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
    this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  }

  private nextGeneration(documentId: string): number {
    const next = (this.documentGenerations.get(documentId) ?? 0) + 1;
    this.documentGenerations.set(documentId, next);
    return next;
  }

  getDocumentGeneration(documentId: string): number {
    return this.documentGenerations.get(documentId) ?? 0;
  }

  /**
   * Groups synchronous baseline registrations so a rejected durable
   * conversion cannot retain assets that no published document references.
   */
  beginDocumentAssetTransaction(documentId: string): DocumentAssetTransaction {
    const existingAssets = new Set<AssetId>();
    for (const [assetId, entry] of this.assets) {
      if (entry.baselineDocuments.has(documentId)) existingAssets.add(assetId);
    }

    let settled = false;
    return {
      commit: () => {
        settled = true;
      },
      rollback: () => {
        if (settled) return;
        settled = true;
        for (const [assetId, entry] of this.assets) {
          if (existingAssets.has(assetId) || !entry.baselineDocuments.delete(documentId)) continue;
          this.release(assetId);
        }
      },
    };
  }

  registerBaseline(
    documentId: string,
    bitmap: BitmapSource,
    options: Readonly<{ ownership?: AssetOwnership }> = {}
  ): AssetId {
    this.disposedDocuments.delete(documentId);
    const originalSourceType = sourceType(bitmap);
    const requestedOwnership = options.ownership ?? (originalSourceType === 'image-bitmap' ? 'adopt' : 'borrow');
    const external = bitmap as unknown as object;
    const existingId = this.externalIds.get(external);
    if (existingId) {
      const existing = this.assets.get(existingId);
      if (existing && !existing.disposed) {
        if (!existing.baselineDocuments.has(documentId)) {
          existing.baselineDocuments.add(documentId);
          existing.retainCount += 1;
          this.nextGeneration(documentId);
        }
        return existingId;
      }
      this.externalIds.delete(external);
    }

    const id = uuidv4() as AssetId;
    // A durable descriptor never aliases a caller-owned HTML image/canvas.
    const storedBitmap = originalSourceType === 'image-bitmap' ? bitmap : immutableRasterCopy(bitmap);
    // A borrowed mutable input remains caller-owned, but its immutable copy
    // is always registry-owned and must be closed on final release.
    const ownership = originalSourceType === 'image-bitmap' ? requestedOwnership : 'adopt';
    const width = bitmapDimension(storedBitmap, 'width');
    const height = bitmapDimension(storedBitmap, 'height');
    const record: AssetRecord = Object.freeze({
      id,
      documentId,
      generation: this.nextGeneration(documentId),
      width,
      height,
      byteSize: width * height * 4,
      sourceType: originalSourceType,
      ownership,
      disposed: false,
    });
    this.assets.set(id, {
      record,
      bitmap: storedBitmap,
      baselineDocuments: new Set([documentId]),
      retainCount: 1,
      disposed: false,
    });
    this.externalIds.set(external, id);
    return id;
  }

  registerBorrowed(documentId: string, bitmap: BitmapSource): AssetId {
    return this.registerBaseline(documentId, bitmap, { ownership: 'borrow' });
  }

  async registerBaselineAsync(
    documentId: string,
    bitmap: BitmapSource,
    options: Readonly<{ ownership?: AssetOwnership }> = {}
  ): Promise<AssetId> {
    // ImageBitmap is already immutable with explicit close semantics.
    if (sourceType(bitmap) === 'image-bitmap') {
      return this.registerBaseline(documentId, bitmap, options);
    }
    const create = globalThis.createImageBitmap;
    if (!create) throw new Error('createImageBitmap is required to adopt a mutable raster source');
    const immutable = await create(bitmap as never);
    // The registry owns the immutable copy; the mutable caller resource was
    // borrowed and remains the caller's responsibility.
    return this.registerBaseline(documentId, immutable, { ownership: 'adopt' });
  }

  getRecord(assetId: AssetId): AssetRecord | undefined {
    const entry = this.assets.get(assetId);
    return entry && !entry.disposed ? entry.record : undefined;
  }

  retain(assetId: AssetId): void {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) throw new Error(`Unknown or disposed asset: ${assetId}`);
    entry.retainCount += 1;
  }

  release(assetId: AssetId): void {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) return;
    entry.retainCount = Math.max(0, entry.retainCount - 1);
    if (entry.retainCount !== 0 || entry.baselineDocuments.size !== 0) return;
    entry.disposed = true;
    if (entry.record.ownership === 'adopt') disposeOwnedBitmap(entry.bitmap);
    this.assets.delete(assetId);
  }

  /** Returns a retained lease. The caller must release it exactly once. */
  async resolve(assetId: AssetId, signal?: AbortSignal): Promise<AssetLease> {
    const entry = this.assets.get(assetId);
    if (!entry || entry.disposed) throw new Error(`Unknown or disposed asset: ${assetId}`);
    if (signal?.aborted) throw new DOMException('Asset resolution aborted', 'AbortError');
    this.retain(assetId);
    let released = false;
    let abortHandler: (() => void) | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
      this.release(assetId);
    };
    if (signal) {
      abortHandler = () => release();
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    return {
      assetId,
      generation: entry.record.generation,
      bitmap: entry.bitmap,
      record: entry.record,
      release,
    };
  }

  /**
   * Returns a retained lease over a cache-owned materialization. Concurrent
   * callers sharing a key share one producer result but receive independent
   * release obligations.
   */
  async materialize<Metadata = undefined>(
    input: Readonly<{
      key: string;
      documentId?: string;
      producer: () =>
        Promise<BitmapSource | MaterializationResult<Metadata>> | BitmapSource | MaterializationResult<Metadata>;
      byteSize?: number;
    }>
  ): Promise<MaterializationLease<Metadata>> {
    const cached = this.cache.get(input.key);
    if (cached && !cached.invalidated) {
      cached.retainCount += 1;
      cached.lastUsed = ++this.clock;
      return this.cacheLease<Metadata>(cached);
    }
    if (cached) {
      throw new DOMException('Materialization invalidated by document disposal', 'AbortError');
    }

    let pending = this.pendingMaterializations.get(input.key);
    const ownsRequest = !pending;
    if (!pending) {
      const documentGeneration = input.documentId ? this.getDocumentGeneration(input.documentId) : undefined;
      pending = (async () => {
        const produced = await input.producer();
        const result =
          typeof produced === 'object' && produced !== null && 'bitmap' in produced
            ? (produced as MaterializationResult<Metadata>)
            : { bitmap: produced as BitmapSource, metadata: undefined as Metadata };

        if (input.documentId && documentGeneration !== this.getDocumentGeneration(input.documentId)) {
          disposeOwnedBitmap(result.bitmap);
          throw new DOMException('Materialization invalidated by document disposal', 'AbortError');
        }

        const entry: CacheEntry = {
          key: input.key,
          documentId: input.documentId,
          bitmap: result.bitmap,
          byteSize:
            input.byteSize ?? bitmapDimension(result.bitmap, 'width') * bitmapDimension(result.bitmap, 'height') * 4,
          metadata: result.metadata,
          // Reserve the first lease before cache eviction. Concurrent waiters
          // retain below after the shared producer resolves.
          retainCount: 1,
          lastUsed: ++this.clock,
          invalidated: false,
        };
        this.cache.set(entry.key, entry);
        this.cacheBytes += entry.byteSize;
        this.evictCache();
        return entry;
      })();
      this.pendingMaterializations.set(input.key, pending);
      void pending.then(
        () => {
          if (this.pendingMaterializations.get(input.key) === pending) this.pendingMaterializations.delete(input.key);
        },
        () => {
          if (this.pendingMaterializations.get(input.key) === pending) this.pendingMaterializations.delete(input.key);
        }
      );
    }

    const entry = await pending;
    if (!ownsRequest) {
      entry.retainCount += 1;
      entry.lastUsed = ++this.clock;
    }
    return this.cacheLease<Metadata>(entry);
  }

  disposeDocument(documentId: string): void {
    if (this.disposedDocuments.has(documentId)) return;
    this.disposedDocuments.add(documentId);
    for (const entry of this.assets.values()) {
      if (!entry.baselineDocuments.delete(documentId)) continue;
      this.release(entry.record.id);
    }
    for (const [key, entry] of this.cache) {
      if (entry.documentId !== documentId) continue;
      if (entry.retainCount === 0) {
        this.removeCacheEntry(key, entry);
      } else {
        entry.invalidated = true;
      }
    }
    this.nextGeneration(documentId);
  }

  /**
   * Releases baselines omitted by a successfully published durable conversion.
   * The caller must include every source reachable from the baseline and the
   * complete replayable history, not just the active cursor projection.
   */
  reconcileDocumentAssets(documentId: string, reachableAssetIds: ReadonlySet<AssetId>): void {
    let changed = false;
    for (const entry of this.assets.values()) {
      if (!entry.baselineDocuments.has(documentId) || reachableAssetIds.has(entry.record.id)) continue;
      entry.baselineDocuments.delete(documentId);
      this.release(entry.record.id);
      changed = true;
    }
    if (changed) this.nextGeneration(documentId);
  }

  /** Releases every document baseline while respecting active leases. */
  shutdown(): void {
    for (const documentId of this.documentGenerations.keys()) this.disposeDocument(documentId);
    this.clearMaterializations();
  }

  clearMaterializations(): void {
    for (const [key, entry] of this.cache) {
      if (entry.retainCount === 0) this.removeCacheEntry(key, entry);
    }
  }

  private cacheLease<Metadata>(entry: CacheEntry): MaterializationLease<Metadata> {
    let released = false;
    return {
      key: entry.key,
      bitmap: entry.bitmap,
      byteSize: entry.byteSize,
      metadata: entry.metadata as Metadata,
      release: () => {
        if (released) return;
        released = true;
        entry.retainCount = Math.max(0, entry.retainCount - 1);
        entry.lastUsed = ++this.clock;
        if (entry.invalidated && entry.retainCount === 0) {
          this.removeCacheEntry(entry.key, entry);
          return;
        }
        this.evictCache();
      },
    };
  }

  private removeCacheEntry(key: string, entry: CacheEntry) {
    if (this.cache.get(key) !== entry) return;
    this.cache.delete(key);
    this.cacheBytes -= entry.byteSize;
    disposeOwnedBitmap(entry.bitmap);
  }

  private evictCache() {
    while (this.cache.size > this.maxCacheEntries || this.cacheBytes > this.maxCacheBytes) {
      const candidate = [...this.cache.values()]
        .filter((entry) => entry.retainCount === 0)
        .sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) break;
      this.removeCacheEntry(candidate.key, candidate);
    }
  }
}

let defaultRegistry: AssetRegistry | undefined;

export function getAssetRegistry(): AssetRegistry {
  defaultRegistry ??= new AssetRegistry();
  return defaultRegistry;
}

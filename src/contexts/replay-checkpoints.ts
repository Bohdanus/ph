export type ReplayCheckpointKey = Readonly<{
  documentId: string;
  documentRevision: number;
  branchRevision: number;
  historyIndex: number;
}>;

export type ReplayCheckpoint<T> = Readonly<{
  key: ReplayCheckpointKey;
  value: T;
  byteSize: number;
  release?: () => void;
}>;

export type ReplayCheckpointCacheOptions = Readonly<{
  maxEntries?: number;
  maxBytes?: number;
}>;

/** Optional accelerator. It never participates in durable correctness. */
export class ReplayCheckpointCache<T> {
  private readonly entries = new Map<string, ReplayCheckpoint<T>>();
  private bytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(options: ReplayCheckpointCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 8;
    this.maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  }

  private key(key: ReplayCheckpointKey): string {
    return `${key.documentId}:${key.documentRevision}:${key.branchRevision}:${key.historyIndex}`;
  }

  get(key: ReplayCheckpointKey): T | undefined {
    return this.entries.get(this.key(key))?.value;
  }

  set(checkpoint: ReplayCheckpoint<T>): void {
    const id = this.key(checkpoint.key);
    const existing = this.entries.get(id);
    if (existing) this.remove(id, existing);
    this.entries.set(id, checkpoint);
    this.bytes += checkpoint.byteSize;
    this.evict();
  }

  invalidate(predicate: (key: ReplayCheckpointKey) => boolean): void {
    for (const [id, checkpoint] of this.entries) {
      if (predicate(checkpoint.key)) this.remove(id, checkpoint);
    }
  }

  clear(): void {
    for (const [id, checkpoint] of this.entries) this.remove(id, checkpoint);
  }

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  private remove(id: string, checkpoint: ReplayCheckpoint<T>) {
    this.entries.delete(id);
    this.bytes = Math.max(0, this.bytes - checkpoint.byteSize);
    checkpoint.release?.();
  }

  private evict() {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const first = this.entries.entries().next().value as [string, ReplayCheckpoint<T>] | undefined;
      if (!first) return;
      this.remove(first[0], first[1]);
    }
  }
}

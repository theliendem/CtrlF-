// Budgets estimate retained data, including string keys and entry overhead, not JS heap size.
export const MiB = 1024 * 1024;
export function bytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 2 + 24;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value == null) return 8;
  if (ArrayBuffer.isView(value)) return value.byteLength + 64;
  if (Array.isArray(value)) return 32 + value.reduce((sum, item) => sum + bytes(item), 0);
  return 48 + Object.entries(value).reduce((sum, [key, item]) => sum + bytes(key) + bytes(item), 0);
}
export class MemoryCache<T> {
  private entries = new Map<string, { value: T; size: number; expires: number }>();
  sizeBytes = 0;
  readonly budget: number;
  private now: () => number;
  constructor(budget: number, now = Date.now) { this.budget = budget; this.now = now; }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) { this.delete(key); return undefined; }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, ttl = Infinity): void {
    this.delete(key);
    const size = bytes(key) + bytes(value) + 64;
    if (size > this.budget) return;
    while (this.sizeBytes + size > this.budget) this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, size, expires: this.now() + ttl });
    this.sizeBytes += size;
  }
  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.sizeBytes -= entry.size;
    this.entries.delete(key);
  }
  clear(): void { this.entries.clear(); this.sizeBytes = 0; }
}
// Raw reads and prepared passages share one budget.
export const contentCache = new MemoryCache<unknown>(8 * MiB);
export async function contentKey(version: string, value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return version + ':' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

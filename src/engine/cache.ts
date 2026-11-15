// Per-URL memory of what was read: page text, link lists and file sections, but never scores.
// A repeat search on the same site skips the network, which is also what lets the demo run offline.
// It lives in memory and is gone when the engine page closes (Chrome or extension restart). With the
// hidden "Keep cache for demos" setting on, it is also copied to IndexedDB (engine/persist.ts).
import type { FileData, FileSection, PageText } from '../shared/types';
import { keepingCache, loadStore, onKeepCacheEnabled, saveStore } from './persist';

const MAX_ENTRIES = 3000;
const store = new Map<string, unknown>();
let loaded: Promise<void> | null = null;

export type CachedRead =
  | { page: PageText; needsTab: boolean; finalUrl: string }
  | { file: Pick<FileData, 'kind' | 'title'>; sections: FileSection[]; finalUrl: string };

/** With the demo cache on, load the stored copy into memory once. Await before recall. */
export function cacheReady(): Promise<void> {
  if (!keepingCache()) return Promise.resolve();
  loaded ??= loadStore('reads').then((entries) => {
    for (const [key, value] of entries) if (!store.has(key)) store.set(key, value);
    trim();
  });
  return loaded;
}

onKeepCacheEnabled(() => {
  loaded = null; // the stored copy may have been deleted while it was off
  saveStore('reads', store.entries());
});

export function recall<T>(key: string): T | undefined {
  const value = store.get(key);
  if (value === undefined) return undefined;
  store.delete(key); // least recently used goes first
  store.set(key, value);
  return value as T;
}

export function remember<T>(key: string, value: T): T {
  store.delete(key);
  store.set(key, value);
  saveStore('reads', [[key, value]], trim());
  return value;
}

/** Drop the least recently used entries over the cap; returns their keys. */
function trim(): string[] {
  const dropped: string[] = [];
  for (const key of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(key);
    dropped.push(key);
  }
  return dropped;
}

/** Pass sections through, and remember them only if the whole file was read. */
export async function* recordSections(key: string, file: Pick<FileData, 'kind' | 'title'>, finalUrl: string, source: AsyncIterable<FileSection>): AsyncGenerator<FileSection> {
  const sections: FileSection[] = [];
  for await (const section of source) {
    sections.push(section);
    yield section;
  }
  remember<CachedRead>(key, { file: { kind: file.kind, title: file.title }, sections, finalUrl });
}

export async function* replaySections(sections: FileSection[]): AsyncGenerator<FileSection> {
  yield* sections;
}

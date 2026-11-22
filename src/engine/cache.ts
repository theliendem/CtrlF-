// Per-URL memory of what was read: page text, link lists and file sections, but never scores.
// A repeat search on the same site skips the network, which is also what lets the demo run offline.
// It lives in memory and is gone when the engine page closes (Chrome or extension restart). With the
// hidden "Keep cache for demos" setting on, it is also copied to IndexedDB (engine/persist.ts).
import type { FileData, FileSection, PageText } from '../shared/types';
import { bytes, contentCache } from './memory';
const TTL = 5 * 60 * 1000;
let generation = 0;

export type CachedRead =
  | { page: PageText; needsTab: boolean; finalUrl: string }
  | { file: Pick<FileData, 'kind' | 'title'>; sections: FileSection[]; finalUrl: string };

export async function cacheReady(): Promise<void> {}
export function recall<T>(key: string): T | undefined {
  return contentCache.get(`read:${key}`) as T | undefined;
}
export function remember<T>(key: string, value: T): T {
  contentCache.set(`read:${key}`, value, TTL);
  return value;
}
export function refreshContent(): void {
  generation++;
  contentCache.clear();
}

/** Pass sections through, and remember them only if the whole file was read. */
export async function* recordSections(key: string, file: Pick<FileData, 'kind' | 'title'>, finalUrl: string, source: AsyncIterable<FileSection>): AsyncGenerator<FileSection> {
  const sections: FileSection[] = [];
  const started = generation;
  let size = 0;
  let cacheable = true;
  for await (const section of source) {
    size += bytes(section);
    if (size > contentCache.budget / 2) { cacheable = false; sections.length = 0; }
    if (cacheable) sections.push(section);
    yield section;
  }
  if (cacheable && started === generation) remember<CachedRead>(key, { file: { kind: file.kind, title: file.title }, sections, finalUrl });
}

export async function* replaySections(sections: FileSection[]): AsyncGenerator<FileSection> {
  yield* sections;
}

// Per-URL memory of what was read: page text, link lists and file sections, but never scores.
// A repeat search on the same site skips the network, which is also what lets the demo run offline.
// LATER: persist to IndexedDB so the cache survives a browser restart.
import type { FileData, FileSection, PageText } from '../shared/types';

const MAX_ENTRIES = 3000;
const store = new Map<string, unknown>();

export type CachedRead =
  | { page: PageText; needsTab: boolean; finalUrl: string }
  | { file: Pick<FileData, 'kind' | 'title'>; sections: FileSection[]; finalUrl: string };

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
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
  return value;
}

export function clearCache(): void {
  store.clear();
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

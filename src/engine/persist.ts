// Demo cache: an IndexedDB copy of the in-memory caches (read cache and embeddings), so a site searched
// once stays fast after Chrome or the extension restarts. Off by default; turned on by the hidden
// "Keep cache for demos" setting. Turning it off deletes the stored copy, so nothing stays on disk.
// Runs in the offscreen engine page. Without IndexedDB (unit tests in Node) every call is a no-op.

const DB_NAME = 'ctrlfpp-demo-cache';
export type StoreName = 'reads' | 'vectors';
const STORES: StoreName[] = ['reads', 'vectors'];

let enabled = false;
/** Set once the first search told us the setting; until then nothing is read, written or deleted. */
let configured = false;
let db: Promise<IDBDatabase> | null = null;
/** Callbacks that copy what's already in memory to disk when the setting is turned on mid-session. */
const flushers: Array<() => void> = [];

const available = (): boolean => typeof indexedDB !== 'undefined';
export const keepingCache = (): boolean => enabled && available();

function open(): Promise<IDBDatabase> {
  db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { for (const name of STORES) req.result.createObjectStore(name); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

/** Apply the user's setting. Turning it off deletes the stored copy; the in-memory caches are untouched. */
export function setKeepCache(on: boolean): void {
  if (configured && on === enabled) return;
  const wasOn = enabled;
  configured = true;
  enabled = on;
  if (!available()) return;
  if (on && !wasOn) for (const flush of flushers) flush();
  if (!on) {
    const closing = db;
    db = null;
    void (closing ? closing.then((d) => d.close(), () => {}) : Promise.resolve()).then(() => indexedDB.deleteDatabase(DB_NAME));
  }
}

export function onKeepCacheEnabled(flush: () => void): void {
  flushers.push(flush);
}

/** Every stored entry of one store, or none when the setting is off. */
export async function loadStore<T>(name: StoreName): Promise<Array<[string, T]>> {
  if (!keepingCache()) return [];
  try {
    const d = await open();
    return await new Promise((resolve, reject) => {
      const store = d.transaction(name, 'readonly').objectStore(name);
      const keys = store.getAllKeys();
      const values = store.getAll();
      values.onsuccess = () => resolve((keys.result as string[]).map((k, i) => [k, values.result[i] as T]));
      values.onerror = () => reject(values.error);
    });
  } catch (error) {
    console.warn('[ctrlf++] demo cache could not be loaded', error);
    return [];
  }
}

/** Write and delete entries in one transaction. Fire and forget: a failed write only costs speed. */
export function saveStore(name: StoreName, put: Iterable<[string, unknown]>, remove: Iterable<string> = []): void {
  if (!keepingCache()) return;
  const puts = [...put];
  const removes = [...remove];
  if (!puts.length && !removes.length) return;
  open().then((d) => {
    const store = d.transaction(name, 'readwrite').objectStore(name);
    for (const [key, value] of puts) store.put(value, key);
    for (const key of removes) store.delete(key);
  }).catch((error: unknown) => console.warn('[ctrlf++] demo cache write failed', error));
}

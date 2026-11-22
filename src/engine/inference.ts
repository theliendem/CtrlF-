// Let browser messages (especially Stop) run between local processing batches.
export async function checkpoint(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal?.throwIfAborted();
}

// Keep shared model sessions serialized. Cancelled jobs skip their turn entirely.
// An active native inference finishes its current batch before the next job starts.
let pending: Promise<unknown> = Promise.resolve();
export function infer<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const result = pending.then(async () => {
    await checkpoint(signal);
    const value = await work();
    signal?.throwIfAborted();
    return value;
  });
  pending = result.catch(() => {});
  return result;
}

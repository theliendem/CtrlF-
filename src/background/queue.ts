import type { DigEntry, DigRun } from '../shared/types';

/** Refill each free slot from the best link currently known anywhere in the tree. */
export async function runBestFirst(
  run: DigRun,
  visit: (entry: DigEntry) => Promise<void>,
  isCurrent: () => boolean,
  budget = 60,
  concurrency = 4,
): Promise<void> {
  const active = new Set<Promise<void>>();
  while (isCurrent() && (run.queue.length || active.size)) {
    while (isCurrent() && active.size < concurrency && run.queue.length && run.started < budget) {
      run.queue.sort((a, b) => b.priority - a.priority);
      const entry = run.queue.shift()!;
      run.started++;
      const task = visit(entry).finally(() => active.delete(task));
      active.add(task);
    }
    if (!active.size) break;
    await Promise.race(active);
  }
}

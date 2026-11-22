import type { DigEntry, DigRun } from '../shared/types';

/**
 * Always read the highest-priority unvisited link anywhere in the tree next
 * (ties: the one queued first). The dig ends when the queue empties or the budget runs out.
 * Once pause() is true, no new reads start; reads in flight finish and the rest stay queued,
 * so calling this again resumes the dig.
 */
export async function runBestFirst(
  run: DigRun,
  visit: (entry: DigEntry) => Promise<void>,
  isCurrent: () => boolean,
  budget = run.settings.pageBudget,
  concurrency = 4,
  pause: () => boolean = () => false,
): Promise<void> {
  const active = new Set<Promise<void>>();
  while (isCurrent() && (run.queue.length || active.size)) {
    while (isCurrent() && !pause() && active.size < concurrency && run.queue.length && run.started < budget) {
      let best = 0;
      for (let i = 1; i < run.queue.length; i++) if (run.queue[i].priority > run.queue[best].priority) best = i;
      const [entry] = run.queue.splice(best, 1);
      run.started++;
      const task = visit(entry).finally(() => active.delete(task));
      active.add(task);
    }
    if (!active.size) break;
    await Promise.race(active);
    // Cached reads can finish entirely in microtasks. Give Stop a turn before dispatching more.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

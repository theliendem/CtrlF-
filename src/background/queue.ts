import type { DigEntry, DigRun } from '../shared/types';

/** Read 1–3 randomly chosen siblings, then switch parent branches when possible. */
export async function runBranchBatches(
  run: DigRun,
  visit: (entry: DigEntry) => Promise<void>,
  isCurrent: () => boolean,
  budget = run.settings.pageBudget,
  concurrency = 4,
): Promise<void> {
  const active = new Set<Promise<void>>();
  let parent: string | null | undefined;
  let remaining = 0;
  while (isCurrent() && (run.queue.length || active.size)) {
    while (isCurrent() && active.size < concurrency && run.queue.length && run.started < budget) {
      const parents = [...new Set(run.queue.map((entry) => entry.node.parentId))];
      if (!remaining || parent === undefined || !parents.includes(parent)) {
        const others = parents.filter((id) => id !== parent);
        const choices = others.length ? others : parents;
        parent = choices[Math.floor(Math.random() * choices.length)];
        remaining = 1 + Math.floor(Math.random() * 3);
      }
      const siblings = run.queue.flatMap((entry, index) => entry.node.parentId === parent ? [index] : []);
      const index = siblings[Math.floor(Math.random() * siblings.length)];
      const [entry] = run.queue.splice(index, 1);
      remaining--;
      run.started++;
      const task = visit(entry).finally(() => active.delete(task));
      active.add(task);
    }
    if (!active.size) break;
    await Promise.race(active);
  }
}

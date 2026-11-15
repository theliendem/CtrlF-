import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBestFirst } from '../src/background/queue.ts';
import type { DigEntry, DigRun } from '../src/shared/types.ts';

function entry(id: string, priority: number): DigEntry {
  return { priority, node: { id, parentId: 'root', url: `https://canvas.wisc.edu/courses/123/pages/${id}`, title: id, kind: 'page', state: 'queued', depth: 1, best: 0 } };
}
function run(queue: DigEntry[]): DigRun {
  return { id: 1, query: 'midterm 2', context: { origin: 'https://canvas.wisc.edu', courseId: '123' }, queue, seen: new Set(), started: 1, failed: 0, settings: { pageBudget: 60, maxDepth: 5, showOffsite: false, showUnreadable: false } };
}

test('best-first queue prioritizes newly found children over older low-scoring links', async () => {
  const dig = run([entry('low', 0.3), entry('high', 0.8)]);
  const order: string[] = [];
  await runBestFirst(dig, async ({ node }) => {
    order.push(node.id);
    if (node.id === 'high') dig.queue.push(entry('child', 0.9));
  }, () => true, 60, 1);
  assert.deepEqual(order, ['high', 'child', 'low']);
});

test('queue never exceeds four concurrent reads or the 60-page budget including root', async () => {
  const dig = run(Array.from({ length: 80 }, (_, i) => entry(String(i), i / 80)));
  let active = 0, max = 0, count = 0;
  await runBestFirst(dig, async () => {
    count++;
    max = Math.max(max, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  }, () => true);
  assert.equal(max, 4);
  assert.equal(count, 59);
  assert.equal(dig.started, 60);
  assert.equal(dig.queue.length, 21);
});

test('stopping prevents dispatching any remaining queued pages', async () => {
  const dig = run([entry('a', 0.9), entry('b', 0.8)]);
  let current = true;
  await runBestFirst(dig, async () => { current = false; }, () => current, 60, 1);
  assert.equal(dig.started, 2);
  assert.equal(dig.queue.length, 1);
});

test('queue honors a saved small budget and the new 200-page default', async () => {
  for (const budget of [3, 200]) {
    const dig = run(Array.from({ length: 220 }, (_, i) => entry(String(i), 0.8)));
    dig.settings.pageBudget = budget;
    let fetched = 0;
    await runBestFirst(dig, async () => { fetched++; }, () => true);
    assert.equal(fetched, budget - 1);
    assert.equal(dig.started, budget);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBranchBatches } from '../src/background/queue.ts';
import type { DigEntry, DigRun } from '../src/shared/types.ts';

function entry(id: string, priority: number): DigEntry {
  return { priority, node: { id, parentId: 'root', url: `https://canvas.wisc.edu/courses/123/pages/${id}`, title: id, kind: 'page', state: 'queued', depth: 1, best: 0 } };
}
function run(queue: DigEntry[]): DigRun {
  return { id: 1, query: 'midterm 2', context: { origin: 'https://canvas.wisc.edu', courseId: '123' }, queue, seen: new Set(), started: 1, failed: 0, settings: { mode: 'exact', pageBudget: 60, maxDepth: 5, showOffsite: false, showUnreadable: false } };
}

test('queue switches parent branches after random groups of 1–3 siblings', async (t) => {
  t.mock.method(Math, 'random', () => 0.5); // Two siblings per group.
  const entries = ['a', 'b', 'c'].flatMap((parent) => Array.from({ length: 6 }, (_, i) => {
    const item = entry(`${parent}${i}`, 1);
    item.node.parentId = parent;
    return item;
  }));
  const dig = run(entries);
  const order: string[] = [];
  await runBranchBatches(dig, async ({ node }) => { order.push(node.parentId!); }, () => true, 60, 1);
  assert.equal(order.length, 18);
  for (let i = 0; i < 12; i += 2) {
    assert.equal(order[i], order[i + 1]);
    if (i) assert.notEqual(order[i], order[i - 1]);
  }
});

test('random batch bounds are one and three, with random selection within each parent', async (t) => {
  for (const random of [0, 0.999]) {
    const stub = t.mock.method(Math, 'random', () => random);
    const entries = ['a', 'b'].flatMap((parent) => Array.from({ length: 8 }, (_, i) => {
      const item = entry(`${parent}${i}`, 1);
      item.node.parentId = parent;
      return item;
    }));
    const order: string[] = [];
    await runBranchBatches(run(entries), async ({ node }) => { order.push(node.id); }, () => true, 60, 1);
    const size = random ? 3 : 1;
    assert.ok(order.slice(0, size).every((id) => id[0] === order[0][0]));
    assert.notEqual(order[size][0], order[0][0]);
    assert.equal(order[0], random ? 'b7' : 'a0');
    assert.equal(new Set(order).size, 16);
    stub.mock.restore();
  }
});

test('queue never exceeds four concurrent reads or the 60-page budget including root', async () => {
  const dig = run(Array.from({ length: 80 }, (_, i) => entry(String(i), i / 80)));
  let active = 0, max = 0, count = 0;
  await runBranchBatches(dig, async () => {
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
  await runBranchBatches(dig, async () => { current = false; }, () => current, 60, 1);
  assert.equal(dig.started, 2);
  assert.equal(dig.queue.length, 1);
});

test('queue honors a saved small budget and the new 200-page default', async () => {
  for (const budget of [3, 200]) {
    const dig = run(Array.from({ length: 220 }, (_, i) => entry(String(i), 0.8)));
    dig.settings.pageBudget = budget;
    let fetched = 0;
    await runBranchBatches(dig, async () => { fetched++; }, () => true);
    assert.equal(fetched, budget - 1);
    assert.equal(dig.started, budget);
  }
});

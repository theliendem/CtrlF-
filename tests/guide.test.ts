import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkPriority, pageRelevance, StallWatch } from '../src/background/guide.ts';
import { PRIORITY_MIN, STALL_LIMIT, type Passage } from '../src/shared/types.ts';

const passage = (score: number): Passage => ({ text: 't', marks: [], score, cos: score, kw: 0 });
const link = (score: number, hub = false) => ({ url: 'https://site.edu/x', title: 'x', heading: '', score, ...(hub ? { hub } : {}) });

test('every starting-page link is queued, ahead of any deeper link', () => {
  const weakRoot = linkPriority(link(0.01), 0, true)!;
  const strongDeep = linkPriority(link(0.9), 0.9, false)!;
  assert.ok(weakRoot.priority > strongDeep.priority);
  assert.equal(weakRoot.estimate, 0.01);
});

test('a vague link on an on-topic page beats the same link on an off-topic page; weak ones are skipped', () => {
  const onTopic = linkPriority(link(0.2), 0.4, false)!;
  const offTopic = linkPriority(link(0.2), 0.05, false);
  assert.ok(onTopic.priority >= PRIORITY_MIN);
  assert.equal(offTopic, null);
  // Canvas hubs survive regardless.
  assert.ok(linkPriority(link(0, true), 0, false));
});

test('pages without text keep their pre-read estimate; pages with text are judged by it', () => {
  assert.equal(pageRelevance([], 0.3), 0.3);
  assert.equal(pageRelevance([passage(0.12), passage(0.05)], 0.3), 0.12);
});

test('the dig stops after enough reads past depth 1 that neither match nor get closer', () => {
  const watch = new StallWatch();
  for (let i = 0; i < 100; i++) assert.equal(watch.record(1, 0.05, false), false); // depth 1 never stalls
  for (let i = 1; i < STALL_LIMIT; i++) assert.equal(watch.record(2, 0.05, false), false);
  assert.equal(watch.record(2, 0.05, false), true);
});

test('getting closer, or a match about as good as the best, resets the count', () => {
  const watch = new StallWatch(3);
  watch.record(2, 0.1, false);
  watch.record(2, 0.1, false);
  assert.equal(watch.record(2, 0.2, false), false); // closer
  watch.record(2, 0.1, false);
  watch.record(2, 0.1, false);
  assert.equal(watch.record(2, 0.15, true), false); // a match within reach of the best (0.2)
  watch.record(2, 0.1, false);
  watch.record(2, 0.1, false);
  assert.equal(watch.record(2, 0.1, false), true);
});

test('weak matches far below the best page do not keep the dig going', () => {
  const watch = new StallWatch(3);
  watch.record(2, 0.55, true); // a real answer
  watch.record(2, 0.29, true); // pages that only share a word
  watch.record(2, 0.27, true);
  assert.equal(watch.record(2, 0.3, true), true);
});

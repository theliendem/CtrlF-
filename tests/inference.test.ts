import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpoint, infer } from '../src/engine/inference.ts';

test('cancelled model jobs skip their turn and never block the next search', async () => {
  let release!: () => void;
  let started!: () => void;
  const activeStarted = new Promise<void>((resolve) => { started = resolve; });
  const active = infer(async () => {
    started();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await activeStarted;
  const controller = new AbortController();
  let staleCalls = 0;
  const stale = infer(async () => { staleCalls++; }, controller.signal);
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  const fresh = infer(async () => 'fresh search');
  controller.abort();
  release();
  await active;
  await rejected;
  assert.equal(staleCalls, 0);
  assert.equal(await fresh, 'fresh search');
});

test('cancellation interrupts active processing between batches, retaining session serialization', async () => {
  const controller = new AbortController();
  let batches = 0;
  const job = infer(async () => {
    for (let i = 0; i < 10; i++) {
      await checkpoint(controller.signal);
      batches++;
      if (batches === 1) setTimeout(() => controller.abort(), 0);
    }
  }, controller.signal);
  await assert.rejects(job, { name: 'AbortError' });
  assert.equal(batches, 1);
  assert.equal(await infer(async () => 42), 42);
});

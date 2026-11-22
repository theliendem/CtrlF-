import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCache, bytes, contentKey } from '../src/engine/memory.ts';
import { recall, remember, refreshContent, recordSections } from '../src/engine/cache.ts';

test('cache evicts least recently used data and accounts for replacement and oversized entries', () => {
  const size = bytes('a') + bytes('value') + 64;
  const cache = new MemoryCache<string>(size * 2);
  cache.set('a', 'value'); cache.set('b', 'value');
  cache.get('a'); cache.set('c', 'value');
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 'value');
  assert.ok(cache.sizeBytes <= cache.budget);
  cache.set('c', 'x'.repeat(1000));
  assert.equal(cache.get('c'), undefined);
  cache.clear(); assert.equal(cache.sizeBytes, 0);
});

test('expiry is based on read freshness, not cache access', () => {
  let now = 0;
  const cache = new MemoryCache<string>(1000, () => now);
  cache.set('a', 'old', 300);
  now = 299; assert.equal(cache.get('a'), 'old');
  now = 300; assert.equal(cache.get('a'), undefined);
  assert.equal(cache.sizeBytes, 0);
});

test('content identity changes with title, body, and preparation version', async () => {
  const key = await contentKey('v1', ['Title', ['Body']]);
  assert.equal(key, await contentKey('v1', ['Title', ['Body']]));
  assert.notEqual(key, await contentKey('v2', ['Title', ['Body']]));
  assert.notEqual(key, await contentKey('v1', ['New title', ['Body']]));
  assert.notEqual(key, await contentKey('v1', ['Title', ['New body']]));
});

test('refresh clears reads and prevents a partially parsed file from repopulating cache', async () => {
  remember('page', { text: 'old' });
  async function* source() { yield { blocks: ['First'] }; refreshContent(); yield { blocks: ['Second'] }; }
  const sections = [];
  for await (const section of recordSections('file', { kind: 'pdf', title: 'File' }, 'file', source())) sections.push(section);
  assert.equal(sections.length, 2);
  assert.equal(recall('page'), undefined);
  assert.equal(recall('file'), undefined);
});

// Run explicitly with npm run test:models. Uses the exact bundled q8 weights, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chunk } from '../src/engine/chunk.ts';
import { tokenCounter, embed } from '../src/engine/embed.ts';
import { rerank } from '../src/engine/rerank.ts';
import { semanticPassages } from '../src/engine/semantic.ts';
import { metrics } from '../scripts/eval/metrics.ts';

// Any accidental remote model loading or inference is a test failure.
globalThis.fetch = async () => { throw new Error('Network access is forbidden in local model tests'); };

test('actual tokenizer keeps every chunk within 256 tokens, including dense code and final words', async () => {
  const countTokens = await tokenCounter();
  const body = 'ArrayList<MySuperLongGenericIdentifier> '.repeat(100) + 'THE_FINAL_SEARCHABLE_SENTENCE.';
  const chunks = chunk(['Code Examples', body], { countTokens, title: 'Java collections' });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => countTokens(c.text) <= 256));
  assert.equal(chunks.flatMap((c) => c.parts).join('').replace(/\s/g, ''), body.replace(/\s/g, ''));
  assert.ok(chunks.at(-1).text.includes('THE_FINAL_SEARCHABLE_SENTENCE.'));
  assert.ok((await embed(chunks.map((c) => c.text))).every((v) => v.length === 384));
});

test('actual cross encoder distinguishes an exam date from an unrelated passage offline', async () => {
  const scores = await rerank('When is midterm 2?', [
    'Midterm 2 takes place on Friday, October 30 at 6 PM in room 205.',
    'A doubly linked list has next and previous references.',
  ]);
  assert.equal(scores.length, 2);
  assert.ok(scores[0] > scores[1] && scores[0] > 0.5);
  await assert.rejects(rerank('word '.repeat(150), ['Some passage.']), /too long/);
});

test('local user regression ranks the linked-list overview first when a private snapshot exists', async (t) => {
  let data;
  try { data = JSON.parse(await readFile('tests/fixtures/canvas.local/linked-list.json', 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Private course snapshot is intentionally not checked into git'); return; } throw error; }
  const query = data.queries[0];
  const pages = [];
  for (const page of data.pages) {
    const passages = await semanticPassages(query.query, page.blocks, { title: page.title });
    pages.push({ id: page.id, score: passages[0]?.score ?? 0 });
  }
  pages.sort((a,b) => b.score-a.score);
  assert.equal(pages[0].id, query.expected[0]);
});

test('benchmark metrics count a missing answer as a miss and abstention as correct', () => {
  const result = metrics([
    {query:'a',expected:['correct'],split:'test',kind:'topic',pages:[{id:'wrong',score:.9},{id:'correct',score:.8}]},
    {query:'b',expected:['missing'],split:'test',kind:'topic',pages:[]},
    {query:'c',expected:[],split:'test',kind:'no-answer',pages:[{id:'noise',score:.1}]},
  ], .3);
  assert.equal(result.hitAt1, 0);
  assert.equal(result.hitAt3, .5);
  assert.equal(result.mrr, .25);
  assert.equal(result.noAnswerAccuracy, 1);
});


test('cached repeated searches preserve scores, order, highlights, and changed-content identity', async () => {
  const query = 'When is midterm 2?';
  const blocks = ['Midterm 2 takes place on Friday, October 30 at 6 PM in room 205.'];
  const first = await semanticPassages(query, blocks, { title: 'Exam schedule' });
  const again = await semanticPassages(query, blocks, { title: 'Exam schedule' });
  assert.deepEqual(again, first);
  const changed = await semanticPassages(query, ['Midterm 2 takes place on Monday, November 2.'], { title: 'Updated exam schedule' });
  assert.match(changed[0].text, /November 2/);
  assert.doesNotMatch(changed[0].text, /October 30/);
  const pair = await rerank(query, [blocks[0]]);
  assert.deepEqual(await rerank(query, [blocks[0], blocks[0]]), [pair[0], pair[0]]);
});

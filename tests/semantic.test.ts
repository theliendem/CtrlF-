import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCanvasHub, isFileLink, linkText, topicTitleBoost, semanticLinks, semanticPassages, type Embed } from '../src/engine/semantic.ts';
import { runBestFirst } from '../src/background/queue.ts';
import { LINK_MIN, LINK_PEEK, SEMANTIC_RELEVANT, type DigEntry, type DigRun } from '../src/shared/types.ts';

// Fake embedder: words map to shared "concept" axes, so texts with different words can still
// mean the same thing. Normalized bag of concepts, like the real model's unit vectors.
const CONCEPTS: Record<string, string> = {
  late: 'deadline', deadline: 'deadline', after: 'deadline', overdue: 'deadline',
  turn: 'submit', submitted: 'submit', submit: 'submit', hand: 'submit',
  calculator: 'tools', bring: 'tools', card: 'tools',
  exam: 'exam', test: 'exam', midterm: 'exam',
  office: 'meet', hours: 'meet', meet: 'meet', professor: 'meet',
};
const AXES = [...new Set(Object.values(CONCEPTS))];
const fakeEmbed: Embed = async (texts) => texts.map((t) => {
  const v = new Float32Array(384);
  for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) if (CONCEPTS[w]) v[AXES.indexOf(CONCEPTS[w])] += 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
});

test('a passage with no shared words is found and its closest sentence is marked', async () => {
  const blocks = [
    'Welcome to the course. We meet in room 1240.',
    'Grading. Work submitted after the deadline loses 10% per day. Groups of three are fine for projects.',
  ];
  const passages = await semanticPassages('can I turn stuff in late', blocks, { embed: fakeEmbed, countTokens: (text) => text.split(/\s+/).length, rerank: null });
  const best = passages[0];
  assert.ok(best.score >= SEMANTIC_RELEVANT, `score ${best.score}`);
  assert.equal(best.kw, 0); // no query word appears in it
  assert.deepEqual(best.marks, ['Work submitted after the deadline loses 10% per day.']);
});

test('keyword sentences are still marked directly when the query words appear', async () => {
  const passages = await semanticPassages('midterm calculator', ['You may bring a calculator to the midterm. Lunch is not provided.'], { embed: fakeEmbed, countTokens: (text) => text.split(/\s+/).length, rerank: null });
  assert.deepEqual(passages[0].marks, ['You may bring a calculator to the midterm.']);
});

test('link text uses title, heading and URL path words, without ids or boilerplate', () => {
  assert.equal(
    linkText({ url: 'https://canvas.wisc.edu/courses/123/files/456789/download', title: 'Midterm 2 review.pdf', heading: 'Week 8' }),
    'Midterm 2 review.pdf · Week 8',
  );
  assert.equal(linkText({ url: 'https://cs.wisc.edu/courses/late-policy.html', title: '', heading: '' }), 'late policy');
});

test('links are ranked by meaning, weak ones dropped, at most the peek cap kept', async () => {
  const links = [
    { url: 'https://site.edu/a', title: 'Cafeteria menu', heading: '' },
    { url: 'https://site.edu/b', title: 'Overdue work policy', heading: '' },
    { url: 'https://site.edu/c', title: 'Exam information', heading: '' },
    ...Array.from({ length: 20 }, (_, i) => ({ url: `https://site.edu/x${i}`, title: `Deadline note ${i}`, heading: '' })),
  ];
  const picked = await semanticLinks('can I hand it in late', links, 1, false, fakeEmbed);
  assert.equal(picked.length, LINK_PEEK);
  assert.ok(picked.every((l) => l.score! >= LINK_MIN));
  assert.ok(!picked.some((l) => l.title === 'Cafeteria menu' || l.title === 'Exam information'));
  assert.ok(picked.every((l, i) => i === 0 || picked[i - 1].score! >= l.score!));
});

test('Canvas hubs are never dropped or capped, only ordered behind better links', async () => {
  const base = 'https://canvas.wisc.edu/courses/123';
  const modules = Array.from({ length: 22 }, (_, i) => ({ url: `${base}/modules#context_module_${i}`, title: `Week ${i}`, heading: '' }));
  const links = [...modules, { url: `${base}/assignments/syllabus`, title: 'Syllabus', heading: '' }, { url: `${base}/pages/late-work`, title: 'Late work', heading: '' }];
  const picked = await semanticLinks('can I turn stuff in late', links, 1, true, fakeEmbed);
  assert.equal(picked.length, 24);
  assert.equal(picked[0].title, 'Late work');
  assert.ok(picked.slice(1).every((l) => l.score === LINK_MIN));
  assert.ok(isCanvasHub(`${base}/modules#context_module_1`) && isCanvasHub(base) && !isCanvasHub(`${base}/pages/late-work`));
});

test('keepAll keeps vaguely titled links, uncapped, still best first', async () => {
  const links = [
    { url: 'https://site.edu/u2', title: 'U2 homework', heading: '' },
    { url: 'https://site.edu/late', title: 'Late work policy', heading: '' },
    ...Array.from({ length: 20 }, (_, i) => ({ url: `https://site.edu/x${i}`, title: `Handout ${i}`, heading: '' })),
  ];
  const picked = await semanticLinks('can I hand it in late', links, 1, false, fakeEmbed, true);
  assert.equal(picked.length, 22);
  assert.equal(picked[0].title, 'Late work policy');
  assert.ok(picked.some((l) => l.title === 'U2 homework' && l.score === LINK_MIN));
});

test('file links are always kept, even with vague names and past the cap', async () => {
  const base = 'https://canvas.wisc.edu/courses/123';
  const links = [
    { url: `${base}/files/42`, title: 'Lecture5.pdf', heading: '' },
    { url: 'https://site.edu/notes/u2.pdf', title: 'U2', heading: '' },
    ...Array.from({ length: 20 }, (_, i) => ({ url: `https://site.edu/x${i}`, title: `Deadline note ${i}`, heading: '' })),
  ];
  const picked = await semanticLinks('can I hand it in late', links, 2, true, fakeEmbed);
  assert.ok(picked.some((l) => l.title === 'Lecture5.pdf' && l.score! >= LINK_MIN));
  assert.ok(picked.some((l) => l.title === 'U2'));
  assert.equal(picked.length, LINK_PEEK + 2);
  assert.ok(isFileLink(`${base}/files/42`) && isFileLink('https://site.edu/a.DOCX') && !isFileLink(`${base}/pages/files`));
});

function entry(id: string, priority: number): DigEntry {
  return { priority, node: { id, parentId: 'root', url: `https://site.edu/${id}`, title: id, kind: 'page', state: 'queued', depth: 1, best: 0 } };
}
const run = (queue: DigEntry[], budget = 60): DigRun => ({ id: 1, query: 'q', context: { origin: 'https://site.edu' }, queue, seen: new Set(), started: 1, failed: 0, settings: { mode: 'semantic', pageBudget: budget, maxDepth: 5, showOffsite: false, showUnreadable: false } });

test('best-first reads the highest-scoring link anywhere next, including ones queued mid-dig', async () => {
  const dig = run([entry('low', 0.3), entry('high', 0.9), entry('mid', 0.5)]);
  const order: string[] = [];
  await runBestFirst(dig, async ({ node }) => {
    order.push(node.id);
    if (node.id === 'high') dig.queue.push(entry('child-of-high', 0.7));
  }, () => true, 60, 1);
  assert.deepEqual(order, ['high', 'child-of-high', 'mid', 'low']);
});

test('best-first respects the page budget and stop', async () => {
  const dig = run(Array.from({ length: 10 }, (_, i) => entry(String(i), i / 10)), 4);
  const order: string[] = [];
  await runBestFirst(dig, async ({ node }) => { order.push(node.id); }, () => true, 4, 1);
  assert.deepEqual(order, ['9', '8', '7']);
  let current = true;
  const stopped = run([entry('a', 0.9), entry('b', 0.8)]);
  await runBestFirst(stopped, async () => { current = false; }, () => current, 60, 1);
  assert.equal(stopped.queue.length, 1);
});

test('best-first pauses with the rest still queued, and a second run resumes it', async () => {
  const dig = run(Array.from({ length: 6 }, (_, i) => entry(String(i), i / 10)));
  const order: string[] = [];
  const visit = async ({ node }: DigEntry): Promise<void> => { order.push(node.id); };
  await runBestFirst(dig, visit, () => true, 60, 2, () => order.length >= 3);
  assert.deepEqual(order, ['5', '4', '3']); // no new reads start once pause() is true
  assert.equal(dig.queue.length, 3);
  await runBestFirst(dig, visit, () => true, 60, 2);
  assert.deepEqual(order, ['5', '4', '3', '2', '1', '0']);
  assert.equal(dig.queue.length, 0);
});

const fakeCount = (text: string): number => text.split(/\s+/).length;

test('reranker sees query/passage pairs and can promote a candidate below the old cutoff', async () => {
  const query = 'when is the assessment';
  const chunks = [
    { text: 'Assessment policy mentions the assessment.', parts: ['Assessment policy mentions the assessment.'] },
    { text: 'Friday at ten in the morning.', parts: ['Friday at ten in the morning.'] },
  ];
  let calls = 0;
  const output = await semanticPassages(query, ['nonempty'], {
    embed: async (texts) => texts.map(() => new Float32Array([0])),
    countTokens: fakeCount, chunks, rerankWeight: 0.65,
    rerank: async (q, texts) => {
      calls++;
      assert.equal(q, query);
      assert.equal(texts.length, 2);
      return texts.map((text) => text.startsWith('Friday') ? 0.95 : 0.05);
    },
  });
  assert.equal(calls, 1);
  assert.equal(output[0].text, chunks[1].text);
  assert.ok(output[0].score >= SEMANTIC_RELEVANT);
  assert.deepEqual(output[0].marks, ['Friday at ten in the morning.']);
});

test('reranking is capped at twenty candidates and still penalizes conflicting exam numbers', async () => {
  const chunks = Array.from({ length: 35 }, (_, i) => ({ text: `Midterm ${i + 1} date is Friday.`, parts: [`Midterm ${i + 1} date is Friday.`] }));
  const output = await semanticPassages('midterm 2 date', ['nonempty'], {
    embed: async (texts) => texts.map(() => new Float32Array([1])), countTokens: fakeCount, chunks,
    rerank: async (_query, texts) => { assert.equal(texts.length, 20); return texts.map(() => 1); },
  });
  assert.equal(output.length, 20);
  assert.equal(output[0].text, 'Midterm 2 date is Friday.');
  assert.ok(output[0].score > output[1].score);
});

test('invalid reranker outputs fail explicitly and empty pages load no models', async () => {
  const options = { embed: fakeEmbed, countTokens: fakeCount, rerank: async () => [NaN] };
  await assert.rejects(semanticPassages('midterm', ['Midterm is Friday.'], options), /invalid scores/);
  assert.deepEqual(await semanticPassages('midterm', [], { rerank: async () => { throw new Error('must not run'); } }), []);
});


test('short topic queries prefer an exact overview title without boosting unrelated pages or questions', () => {
  assert.ok(topicTitleBoost('linked list', 'Overview: Linked Lists') > 0);
  assert.equal(topicTitleBoost('linked list', 'LLM: Linked Lists'), 0);
  assert.equal(topicTitleBoost('linked list', 'LEC28: Doubly Linked Lists Posted!'), 0);
  assert.equal(topicTitleBoost('when is midterm 2', 'Overview: Midterm 2'), 0);
  assert.equal(topicTitleBoost('program 7', 'Overview: Program 8'), 0);
});

test('cancelling passage embedding prevents reranking and further scoring', async () => {
  const controller = new AbortController();
  let reranked = false;
  await assert.rejects(semanticPassages('midterm', ['Midterm review notes.'], {
    signal: controller.signal,
    countTokens: (text) => text.split(/\s+/).length,
    embed: async (texts, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      return fakeEmbed(texts);
    },
    rerank: async () => { reranked = true; return [1]; },
  }), { name: 'AbortError' });
  assert.equal(reranked, false);
});

test('cancelled link scoring returns no stale recommendations', async () => {
  const controller = new AbortController();
  await assert.rejects(semanticLinks('midterm', [{ url: 'https://example.edu/notes', title: 'Midterm', heading: '' }], 1, false,
    async (texts, signal) => {
      assert.equal(signal, controller.signal);
      controller.abort();
      return fakeEmbed(texts);
    }, true, controller.signal), { name: 'AbortError' });
});

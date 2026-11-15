import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCanvasHub, linkText, semanticLinks, semanticPassages, splitLinks, type Embed } from '../src/engine/semantic.ts';
import { runBestFirst } from '../src/background/queue.ts';
import { LINK_MIN, LINK_PEEK, SEMANTIC_RELEVANT, SHOW_REJECTED, type DigEntry, type DigRun } from '../src/shared/types.ts';

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
  const passages = await semanticPassages('can I turn stuff in late', blocks, fakeEmbed);
  const best = passages[0];
  assert.ok(best.score >= SEMANTIC_RELEVANT, `score ${best.score}`);
  assert.equal(best.kw, 0); // no query word appears in it
  assert.deepEqual(best.marks, ['Work submitted after the deadline loses 10% per day.']);
});

test('keyword sentences are still marked directly when the query words appear', async () => {
  const passages = await semanticPassages('midterm calculator', ['You may bring a calculator to the midterm. Lunch is not provided.'], fakeEmbed);
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

test('rejected links are the best ones not kept: past the cap first, then the weak ones', async () => {
  const links = [
    { url: 'https://site.edu/a', title: 'Cafeteria menu', heading: '' },
    { url: 'https://site.edu/c', title: 'Exam information', heading: '' },
    ...Array.from({ length: 20 }, (_, i) => ({ url: `https://site.edu/x${i}`, title: `Deadline note ${i}`, heading: '' })),
  ];
  const { kept, rejected } = await splitLinks('can I hand it in late', links, 1, false, fakeEmbed);
  assert.equal(kept.length, LINK_PEEK);
  assert.equal(rejected.length, 7); // 5 deadline notes past the cap, then the 2 weak links
  assert.ok(rejected.slice(0, 5).every((l) => l.title.startsWith('Deadline')));
  assert.ok(!rejected.some((r) => kept.some((k) => k.url === r.url)));
  const many = Array.from({ length: 40 }, (_, i) => ({ url: `https://site.edu/m${i}`, title: `Menu ${i}`, heading: '' }));
  assert.equal((await splitLinks('can I hand it in late', many, 1, false, fakeEmbed)).rejected.length, SHOW_REJECTED);
});

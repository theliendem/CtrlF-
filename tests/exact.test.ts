import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactLinks, exactMatches, exactPassages } from '../src/engine/exact.ts';
import { normalizeSettings } from '../src/shared/settings.ts';

test('exact mode matches only the literal phrase, ignoring case and whitespace', () => {
  const text = 'Intro. MIDTERM\n 2 is Friday. Midterm 1 is Monday. midterm2 is different.';
  assert.deepEqual(exactMatches('midterm 2', text).map((m) => m.text), ['MIDTERM\n 2']);
  assert.deepEqual(exactPassages('midterm 2', [text])[0].marks, ['MIDTERM\n 2']);
  assert.equal(exactPassages('exam date', [text]).length, 0);
});

test('literal punctuation is escaped and repeated occurrences retain distinct positions', () => {
  const text = 'C++ then C++ and C--';
  assert.deepEqual(exactMatches('C++', text).map((m) => text.slice(m.start, m.end)), ['C++', 'C++']);
  assert.equal(exactMatches('.*', text).length, 0);
  assert.equal(exactMatches('  ', text).length, 0);
  assert.equal(exactPassages('midterm 2', ['midterm', '2'])[0].marks[0], 'midterm\n2');
});

test('all safe candidates survive regardless of title or previous score, beyond 15 links', () => {
  const links = Array.from({ length: 45 }, (_, i) => ({ url: `/courses/123/pages/lesson-${i}`, title: 'Unrelated lesson', heading: '', score: 0.01 }));
  const selected = exactLinks(links, 'midterm 2');
  assert.equal(selected.length, 45);
  assert.ok(selected.every((link) => link.score === 0));
  assert.deepEqual(selected.map((link) => link.url), links.map((link) => link.url));
});

test('old saved settings migrate to exact; semantic selection persists', () => {
  assert.equal(normalizeSettings({ pageBudget: 300 }).mode, 'semantic');
  assert.equal(normalizeSettings({ mode: 'exact' }).mode, 'exact');
  assert.equal(normalizeSettings({ mode: 'unknown' }).mode, 'semantic');
});

test('link ranking favors literal titles, then URL clues and headings, without dropping weak links', () => {
  const links = [
    { url: 'https://school.edu/policies', title: 'Course policies', heading: '' },
    { url: 'https://school.edu/notes', title: 'Notes', heading: 'Midterm 2' },
    { url: 'https://school.edu/midterm%202-review.pdf', title: 'Review', heading: '' },
    { url: 'https://school.edu/files/42', title: 'MIDTERM 2 study guide.pdf', heading: '' },
    { url: 'https://school.edu/files/43', title: 'Midterm 1 study guide.pdf', heading: '' },
  ];
  const before = structuredClone(links);
  const ranked = exactLinks(links, 'midterm 2').sort((a, b) => b.score! - a.score!);
  assert.deepEqual(ranked.map((l) => l.url), [links[3].url, links[2].url, links[1].url, links[4].url, links[0].url]);
  assert.deepEqual(links, before);
  assert.equal(exactPassages('midterm 2', ['Midterm 1 study guide']).length, 0);
});

test('ranking handles punctuation, empty queries and malformed URLs without losing links', () => {
  const links = [{ url: 'malformed', title: 'C++ reference', heading: '' }];
  assert.ok(exactLinks(links, 'C++')[0].score! > 0);
  assert.equal(exactLinks(links, '')[0].score, 0);
});

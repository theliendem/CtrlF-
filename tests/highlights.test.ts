import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightPieces, scorePassages } from '../src/engine/score.ts';

function marks(query: string, parts: string[]): string[] {
  return scorePassages(query, new Float32Array([1]), [{ text: parts.join(' '), parts }], [new Float32Array([1])])[0].marks;
}

test('a single paragraph highlights the matching sentence, not its neighbors', () => {
  assert.deepEqual(marks('midterm 2', ['Read chapter 7 before class. Midterm 2 is on Friday. Homework is due Monday.']), ['Midterm 2 is on Friday.']);
});

test('merged passages exclude other headings, dates, and conflicting exam numbers', () => {
  assert.deepEqual(marks('midterm 2', ['Midterm 1 is Monday.', 'Midterm 2 is Friday.', 'Bring a calculator.']), ['Midterm 2 is Friday.']);
});

test('semicolons separate unrelated clauses and stronger query coverage wins', () => {
  assert.deepEqual(marks('midterm 2 date', ['Midterm 2 date: Friday; homework is due Monday.', 'The date for office hours changed.']), ['Midterm 2 date: Friday']);
});

test('no keyword match never falls back to highlighting the whole paragraph', () => {
  assert.deepEqual(marks('exam location', ['The assessment takes place in Van Vleck. Bring a pencil.']), []);
});

test('sentence extraction preserves punctuation and exact DOM-matchable substrings', () => {
  assert.deepEqual(highlightPieces(['Midterm 2 is Friday, November 20. Review starts at 3 p.m.']), ['Midterm 2 is Friday, November 20.', 'Review starts at 3 p.m.']);
});

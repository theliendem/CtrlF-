import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk } from '../src/engine/chunk.ts';

const countTokens = (text: string): number => text.length + 2;

test('token-dense text is split without losing the tail or exceeding the model limit', () => {
  const body = 'abcdefghijklmnopqrstuvwxyz'.repeat(30) + ' searchable-tail';
  const chunks = chunk([body], { countTokens, maxTokens: 64 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((piece) => countTokens(piece.text) <= 64));
  assert.equal(chunks.flatMap((piece) => piece.parts).join('').replace(/\s/g, ''), body.replace(/\s/g, ''));
  assert.ok(chunks.at(-1)!.text.includes('searchable-tail'));
});

test('headings follow later paragraphs and overlap retains the previous sentence', () => {
  const first = 'This first paragraph explains the rules for taking the examination and contains enough detail to fill a complete passage on its own. '.repeat(3).trim();
  const second = 'It takes place Friday at ten in the morning. Bring a pencil.';
  const chunks = chunk(['Midterm 2', first, second]);
  const last = chunks.at(-1)!;
  assert.ok(last.text.includes('Midterm 2'));
  assert.ok(last.text.includes('complete passage on its own.'));
  assert.ok(last.text.includes(second));
  assert.ok(!last.parts.includes('Midterm 2'), 'repeated context is not a highlight target');
});

test('overlap and heading context never cross a new section or the token budget', () => {
  const chunks = chunk(['Midterm 1', 'It takes place on Monday.', 'Midterm 2', 'It takes place on Friday.'], { countTokens, maxTokens: 40 });
  assert.ok(chunks.every((piece) => countTokens(piece.text) <= 40));
  const friday = chunks.find((piece) => piece.parts.some((part) => part.includes('Friday')))!;
  assert.ok(!friday.text.includes('Monday') && !friday.text.includes('Midterm 1'));
});

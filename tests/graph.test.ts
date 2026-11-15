import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Graph, bridges } from '../src/sidepanel/graph.ts';
import type { TreeNode } from '../src/shared/types.ts';

// Minimal SVG surface; tests exercise the real graph updates and cleanup timers.
class Element {
  children: Element[] = [];
  parent: Element | null = null;
  attrs = new Map<string, string>();
  style: Record<string, any> = { setProperty: (key: string, value: string) => { this.style[key] = value; } };
  classList = { add: (value: string) => this.setAttribute('class', value) };
  clientHeight = 500;
  textContent = '';
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  setAttribute(key: string, value: string): void { this.attrs.set(key, value); }
  addEventListener(): void {}
  append(...children: Element[]): void { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(): void { this.children = []; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((el) => el !== this); }
  querySelector(tag: string): Element | undefined {
    for (const child of this.children) { if (child.tag === tag) return child; const found = child.querySelector(tag); if (found) return found; }
  }
}

function node(id: string, state: TreeNode['state'], parentId: string | null = null): TreeNode {
  return { id, state, parentId, title: id, url: `https://canvas.wisc.edu/${id}`, kind: 'page', depth: parentId ? 1 : 0, best: 0 };
}

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  Object.assign(globalThis, { document: { createElementNS: (_ns: string, tag: string) => new Element(tag) } });
  const host = new Element('host');
  const graph = new Graph(host as unknown as HTMLElement, () => {});
  const titles = () => host.children[0].children[0].children[1].children.map((el) => el.querySelector('title')?.textContent.split('\n')[0]);
  return { graph, titles };
}

test('dead gray nodes disappear at the randomized delay, leaving useful nodes', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'hit'));
  graph.upsert(node('dead', 'ruled-out', 'root'));
  t.mock.timers.tick(749);
  assert.deepEqual(titles(), ['root', 'dead']);
  t.mock.timers.tick(1);
  assert.deepEqual(titles(), ['root']);
});

test('gray ancestors remain for waiting, reading, or matching descendants at any depth', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert(node('middle', 'ruled-out', 'root'));
  graph.upsert(node('child', 'queued', 'middle'));
  for (const state of ['queued', 'reading', 'hit'] as const) {
    graph.upsert(node('child', state, 'middle'));
    t.mock.timers.tick(2000);
    assert.deepEqual(titles(), ['root', 'middle', 'child']);
  }
});

test('ancestors become collectable when their last potentially useful descendant is ruled out', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert(node('child', 'reading', 'root'));
  t.mock.timers.tick(2000);
  graph.upsert(node('child', 'ruled-out', 'root'));
  t.mock.timers.tick(750);
  assert.deepEqual(titles(), []);
});

test('a node turning green cancels its removal and reset cancels old timers', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  t.mock.timers.tick(500);
  graph.upsert(node('root', 'hit'));
  t.mock.timers.tick(1000);
  assert.deepEqual(titles(), ['root']);
  graph.upsert(node('old', 'unreadable', 'root'));
  graph.reset();
  graph.upsert(node('old', 'queued'));
  t.mock.timers.tick(1000);
  assert.deepEqual(titles(), ['old']);
});

test('late useful children restore collected ancestors', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert(node('middle', 'ruled-out', 'root'));
  t.mock.timers.tick(750);
  assert.deepEqual(titles(), []);
  graph.upsert(node('child', 'queued', 'middle'));
  t.mock.timers.tick(2000);
  assert.deepEqual(new Set(titles()), new Set(['root', 'middle', 'child']));
});

test('deferred waiting children stay invisible but preserve their gray ancestor', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert({ ...node('child', 'queued', 'root'), deferred: true });
  t.mock.timers.tick(2000);
  assert.deepEqual(titles(), ['root']);
  graph.upsert({ ...node('child', 'reading', 'root'), deferred: false });
  assert.deepEqual(titles(), ['root', 'child']);
  graph.upsert({ ...node('child', 'hit', 'root'), deferred: false });
  t.mock.timers.tick(2000);
  assert.deepEqual(titles(), ['root', 'child']);
});

test('stopping hidden queued children allows dead ancestors to disappear without revealing the queue', (t) => {
  const { graph, titles } = setup(t);
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert({ ...node('child', 'queued', 'root'), deferred: true });
  graph.upsert({ ...node('child', 'not-followed', 'root'), deferred: true });
  assert.deepEqual(titles(), ['root']);
  t.mock.timers.tick(750);
  assert.deepEqual(titles(), []);
});

test('ancestors of a hit show as bridges, even when their own read was ruled out', (t) => {
  const { graph } = setup(t);
  const host = (graph as unknown as { dots: Element }).dots;
  graph.upsert(node('root', 'ruled-out'));
  graph.upsert(node('middle', 'ruled-out', 'root'));
  graph.upsert(node('leaf', 'hit', 'middle'));
  const cls = (id: string) => host.children.find((el) => el.querySelector('title')?.textContent.startsWith(id))?.attrs.get('class');
  assert.equal(cls('root'), 'node bridge');
  assert.equal(cls('middle'), 'node bridge');
  assert.equal(cls('leaf'), 'node hit');
});

const scored = (id: string, parentId: string | null, score: number): TreeNode =>
  ({ ...node(id, 'hit', parentId), hits: [{ text: id, marks: [id], score, cos: 0, kw: 0 }] });

test('a weak hit that leads to a stronger one is a bridge; strong hits stay hits', () => {
  const tree = [
    scored('english', null, 0.27), // barely relevant, but led somewhere better
    scored('rowling', 'english', 0.6),
    scored('strong-parent', null, 0.5), // relevant itself: stays a hit
    scored('strong-child', 'strong-parent', 0.7),
    scored('weak-leaf', null, 0.3), // nothing below it: stays a hit
  ];
  const b = bridges(tree);
  assert.deepEqual([...b.keys()], ['english']);
  assert.equal(b.get('english'), 'rowling');
});

test('a bridge points at the child on the path to its best hit below', () => {
  const tree = [node('root', 'ruled-out'), node('a', 'ruled-out', 'root'), scored('a1', 'a', 0.4), node('b', 'ruled-out', 'root'), scored('b1', 'b', 0.8)];
  const b = bridges(tree);
  assert.equal(b.get('root'), 'b');
  assert.equal(b.get('a'), 'a1');
  assert.equal(b.get('b'), 'b1');
  assert.ok(!b.has('a1') && !b.has('b1'));
});

// Best-first dig. Owner: A. Runs in the offscreen document (long-lived, has DOMParser and the
// engine). The service worker only routes START/STOP/RESUME here; MV3 workers get killed when idle,
// which would lose the queue mid-dig.
import { CRAWL, type DigLog, type DigSettings, type Hit, type LinkFeatures, type LinkRef, type Msg, type NodeState, type SourceDoc, type TreeEvent } from '../../../shared/contracts';
import type { Engine } from '../../../shared/engine-api';
import { canvasCourseOf, isSafeToFetch, loadDoc } from '../sources';

type QItem = { url: string; nodeId: string; parentId: string; depth: number; score: number; title: string; features: LinkFeatures };

/** Max-heap on score. */
class Heap {
  private a: QItem[] = [];
  get size() {
    return this.a.length;
  }
  push(x: QItem) {
    const a = this.a;
    a.push(x);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p].score >= a[i].score) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): QItem | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].score > a[m].score) m = l;
        if (r < a.length && a[r].score > a[m].score) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** One key per real page, so /files/9, /files/9?wrap=1 and /files/9/download are the same node. */
export function canonicalUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  if (canvasCourseOf(url) || /^\/files\/\d+/.test(u.pathname)) {
    u.search = '';
    u.pathname = u.pathname.replace(/\/(download|preview)$/, '').replace(/\/+$/, '');
  }
  return u.href;
}

/**
 * Canvas navigation hubs (syllabus, modules list, a module, announcements, assignments list) rarely
 * share words with a question but lead everywhere. They always get queued, just above minScore,
 * so best-first still visits strong links first.
 */
export function isHub(url: string): boolean {
  if (!canvasCourseOf(url)) return false;
  return /^\/courses\/\d+\/(assignments\/syllabus|modules(\/\d+)?|announcements|assignments)\/?$/.test(new URL(url).pathname);
}

/** Registrable domain, roughly: transportation.wisc.edu and www.wisc.edu are the same site. */
export function siteOf(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2 || /^\d+$/.test(parts[parts.length - 1])) return hostname;
  // Two-part public suffixes like co.uk, ac.uk, com.au.
  const twoPart = /^(co|ac|gov|edu|org|net|com)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoPart ? -3 : -2).join('.');
}

/** Links that are never readable pages (PDFs are fine). */
const NOT_A_PAGE = /\.(png|jpe?g|gif|svg|webp|ico|bmp|mp[34]|m4a|mov|avi|webm|wav|zip|gz|tgz|rar|7z|dmg|exe|msi|apk|iso|css|js|json|xml|rss|atom|ics|vcf|docx?|xlsx?|pptx?|csv|txt)$/i;

/** Max skipped stubs drawn per parent, so a link-heavy page doesn't flood the tree. */
const MAX_STUBS_PER_PARENT = 12;
const SNIPPET_LEN = 140;


export class Dig {
  readonly id = `dig-${Date.now().toString(36)}`;
  private heap = new Heap();
  private seen = new Set<string>(); // canonical urls queued or visited
  private inflight = 0;
  private pagesSearched = 0;
  private strongHits = 0;
  private asked = false;
  private nodeCount = 0;
  private hits: Hit[] = [];
  private t0 = performance.now();
  private status: 'running' | 'paused' | 'stopped' | 'done' = 'running';
  readonly logs: DigLog[] = [];
  /** Dev hook (offscreen console): sees every message the dig sends. */
  onMsg?: (m: Msg) => void;

  constructor(
    private engine: Engine,
    readonly query: string,
    readonly rootUrl: string,
    readonly settings: DigSettings,
    private onLogs: (logs: DigLog[]) => void,
  ) {}

  private send(msg: Msg) {
    this.onMsg?.(msg);
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  private emit(e: Omit<TreeEvent, 't'>) {
    this.send({ type: 'TREE_EVENT', digId: this.id, event: { ...e, t: Math.round(performance.now() - this.t0) } });
  }

  private newNodeId() {
    return `n${this.nodeCount++}`;
  }

  async start() {
    const rootId = this.newNodeId();
    let root = this.rootUrl;
    // On Canvas, pages we can't read via the API (e.g. a quiz page) fall back to the course home.
    const course = canvasCourseOf(root);
    if (course && !isSafeToFetch(root)) root = `${course.origin}/courses/${course.courseId}`;
    this.seen.add(canonicalUrl(root));
    await this.visit({ url: root, nodeId: rootId, parentId: '', depth: 0, score: 1, title: 'This page', features: { relevance: 1, depth: 0, isPdf: 0, isSyllabus: 0, keywordHits: 0 } }, null);
    this.pump();
  }

  stop() {
    if (this.status === 'done' || this.status === 'stopped') return;
    this.status = 'stopped';
    this.finish('stopped');
  }

  resume() {
    if (this.status !== 'paused' && this.status !== 'stopped') return;
    this.status = 'running';
    this.pump();
  }

  private inScope(url: string): boolean {
    if (this.settings.scope === 'any') return true;
    const a = new URL(this.rootUrl);
    const b = new URL(url);
    if (siteOf(a.hostname) !== siteOf(b.hostname)) return false;
    // On Canvas, stay inside the course we started in (plus bare /files/:id links).
    const ca = canvasCourseOf(this.rootUrl);
    if (ca) {
      const cb = canvasCourseOf(url);
      return (cb?.courseId === ca.courseId) || /^\/files\/\d+/.test(b.pathname);
    }
    return true;
  }

  private pump() {
    while (this.status === 'running' && this.inflight < CRAWL.concurrency && this.heap.size > 0) {
      if (this.pagesSearched + this.inflight >= this.settings.pageBudget) break;
      const item = this.heap.pop()!;
      this.inflight++;
      this.visit(item, item.parentId).finally(() => {
        this.inflight--;
        this.pump();
      });
    }
    if (this.status !== 'running' || this.inflight > 0) return;
    if (this.heap.size === 0) this.finish('exhausted');
    else if (this.pagesSearched >= this.settings.pageBudget) this.finish('budget');
  }

  private finish(reason: 'budget' | 'exhausted' | 'stopped' | 'ask') {
    if (reason !== 'ask' && reason !== 'stopped') this.status = 'done';
    const hits = [...this.hits].sort((a, b) => b.score - a.score);
    this.send({ type: 'DIG_DONE', digId: this.id, reason, pagesSearched: this.pagesSearched, hits });
  }

  private async load(url: string, title: string): Promise<SourceDoc | null> {
    const isFile = /\/files\/\d+|\.pdf($|\?)/i.test(url);
    const ms = isFile ? CRAWL.timeoutMs * 2.5 : CRAWL.timeoutMs; // PDFs download + parse; give them 20 s
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)));
    try {
      return await Promise.race([loadDoc(url, title), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Searches one doc; returns its best hits (all passage urls in the doc). */
  private async searchDoc(doc: SourceDoc): Promise<Hit[]> {
    if (!doc.passages.length) return [];
    const urls = [...new Set(doc.passages.map((p) => p.url))];
    for (const u of urls) await this.engine.remove(u);
    const vectors = await this.engine.embed(doc.passages.map((p) => p.text));
    await this.engine.indexAdd(doc.passages, vectors);
    const hits = (await Promise.all(urls.map((u) => this.engine.search(this.query, 3, u)))).flat();
    return hits.sort((a, b) => b.score - a.score);
  }

  private async visit(item: QItem, parentId: string | null) {
    const base = { nodeId: item.nodeId, parentId, url: item.url, title: item.title };
    this.emit({ ...base, state: 'digging', score: item.score });
    let doc: SourceDoc | null = null;
    try {
      doc = await this.load(item.url, item.title);
    } catch (e) {
      console.warn('[ctrlfpp dig] load failed', item.url, e);
    }
    if (this.status === 'stopped') {
      // Put it back so RESUME_DIG picks it up again.
      if (parentId !== null) {
        this.heap.push(item);
        this.emit({ ...base, state: 'queued', score: item.score });
      }
      return;
    }
    this.pagesSearched++;

    let state: NodeState = 'dead';
    let best: Hit | undefined;
    if (doc) {
      const title = parentId === null ? doc.title : item.title || doc.title;
      base.title = title;
      try {
        const hits = await this.searchDoc(doc);
        best = hits[0];
        const w = this.engine.weights();
        if (best && best.score >= w.hitScore) state = 'hit';
        else if (best && best.score >= w.minScore) state = 'relevant';
        if (best && state !== 'dead') this.hits.push(...hits.filter((h) => h.score >= w.minScore));
      } catch (e) {
        console.warn('[ctrlfpp dig] search failed', item.url, e);
      }
    }
    this.emit({
      ...base,
      state,
      score: best?.score ?? 0,
      ...(best && state !== 'dead' ? { snippet: best.text.slice(0, SNIPPET_LEN), hit: best } : {}),
    });

    if (parentId !== null) {
      const f = item.features;
      const log: DigLog = { query: this.query, url: item.url, depth: item.depth, relevance: f.relevance, isPdf: !!f.isPdf, isSyllabus: !!f.isSyllabus, keywordHits: f.keywordHits, outcome: state === 'hit' ? 'hit' : state === 'relevant' ? 'relevant' : 'dead' };
      this.logs.push(log);
      this.onLogs([log]);
    }

    if (state === 'hit') this.strongHits++;
    if (doc && item.depth < this.settings.maxDepth) await this.expand(doc.links, item.nodeId, item.depth + 1);

    if (this.strongHits >= CRAWL.strongHitsBeforeAsk && !this.asked && this.status === 'running') {
      this.asked = true;
      this.status = 'paused';
      this.finish('ask');
    }
  }

  private async expand(links: LinkRef[], parentId: string, depth: number) {
    const fresh: LinkRef[] = [];
    const local = new Set<string>();
    for (const l of links) {
      let key: string;
      try {
        key = canonicalUrl(l.url);
      } catch {
        continue;
      }
      if (this.seen.has(key) || local.has(key)) continue;
      if (!this.inScope(l.url) || !isSafeToFetch(l.url, l.text) || NOT_A_PAGE.test(new URL(l.url).pathname)) continue;
      local.add(key);
      fresh.push(l);
    }
    if (!fresh.length) return;
    const scores = await this.engine.scoreLinks(this.query, fresh, depth);
    const min = this.engine.weights().minScore;
    let stubs = 0;
    fresh.forEach((l, i) => {
      const key = canonicalUrl(l.url);
      if (this.seen.has(key)) return;
      const { features } = scores[i];
      const score = isHub(l.url) ? Math.max(scores[i].score, min + 0.05) : scores[i].score;
      const title = l.text || decodeURIComponent(new URL(l.url).pathname.split('/').pop() || l.url);
      if (score < min) {
        if (stubs++ < MAX_STUBS_PER_PARENT) this.emit({ nodeId: this.newNodeId(), parentId, url: l.url, title, state: 'skipped', score });
        return;
      }
      this.seen.add(key);
      const nodeId = this.newNodeId();
      this.emit({ nodeId, parentId, url: l.url, title, state: 'queued', score });
      this.heap.push({ url: l.url, nodeId, parentId, depth, score, title, features });
    });
  }
}

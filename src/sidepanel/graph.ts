// Basic tree graph: root on the left, children to the right, siblings stacked.
// Milestone 5 replaces the layout with smooth re-flow, pulsing, trails and a follow camera.
import type { TreeNode } from '../shared/types';

const SVG = 'http://www.w3.org/2000/svg';
const DX = 90;
const DY = 26;

export class Graph {
  private svg: SVGSVGElement;
  private edges: SVGGElement;
  private dots: SVGGElement;
  private nodes = new Map<string, TreeNode>();
  private els = new Map<string, { g: SVGGElement; line?: SVGLineElement }>();
  private collected = new Set<string>();
  private cleanup = new Map<string, ReturnType<typeof setTimeout>>();
  private host: HTMLElement;
  private onClick: (id: string) => void;

  constructor(host: HTMLElement, onClick: (id: string) => void) {
    this.host = host;
    this.onClick = onClick;
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('graph-svg');
    this.edges = document.createElementNS(SVG, 'g');
    this.dots = document.createElementNS(SVG, 'g');
    this.svg.append(this.edges, this.dots);
    host.append(this.svg);
  }

  reset(): void {
    for (const timer of this.cleanup.values()) clearTimeout(timer);
    this.cleanup.clear();
    this.collected.clear();
    this.nodes.clear();
    this.els.clear();
    this.edges.replaceChildren();
    this.dots.replaceChildren();
    this.svg.style.minHeight = '';
    this.svg.style.minWidth = '';
  }

  upsert(n: TreeNode): void {
    // Keep ancestry metadata even when its circle is gone: children may arrive later.
    this.nodes.set(n.id, n);
    const gray = n.state === 'ruled-out' || n.state === 'not-followed' || n.state === 'unreadable';
    // A late child can make a previously collected branch useful again.
    if (!gray) {
      let parentId = n.parentId;
      while (parentId) {
        const parent = this.nodes.get(parentId);
        if (!parent) break;
        if (this.collected.has(parentId)) {
          this.collected.delete(parentId);
          this.upsert(parent);
        }
        parentId = parent.parentId;
      }
    }
    if (n.deferred) {
      this.scheduleCleanup();
      return;
    }
    if (n.hidden && !this.protectedAncestors().has(n.id)) {
      this.collect(n.id, true);
      return;
    }
    if (gray && this.collected.has(n.id)) return;
    if (!gray) {
      clearTimeout(this.cleanup.get(n.id));
      this.cleanup.delete(n.id);
      this.collected.delete(n.id);
    }
    let el = this.els.get(n.id);
    if (!el) {
      const g = document.createElementNS(SVG, 'g');
      const c = document.createElementNS(SVG, 'circle');
      const label = document.createElementNS(SVG, 'text');
      const title = document.createElementNS(SVG, 'title');
      label.setAttribute('x', '10');
      label.setAttribute('y', '4');
      g.append(c, label, title);
      g.addEventListener('click', () => this.onClick(n.id));
      this.dots.append(g);
      let line: SVGLineElement | undefined;
      if (n.parentId) {
        line = document.createElementNS(SVG, 'line');
        this.edges.append(line);
      }
      el = { g, line };
      this.els.set(n.id, el);
    }
    el.g.setAttribute('class', `node ${n.state}`);
    (el.g.querySelector('text') as SVGTextElement).textContent = n.state === 'hit' ? n.title : '';
    (el.g.querySelector('title') as unknown as SVGTitleElement).textContent = `${n.title}\n${n.url}\n${n.state}${n.state === 'unreadable' ? `: ${n.snippet ?? ''}` : ''}`;
    (el.g.querySelector('circle') as SVGCircleElement).setAttribute('r', n.state === 'queued' ? '4' : '6');
    this.scheduleCleanup();
    this.layout();
  }

  private protectedAncestors(): Set<string> {
    const protectedIds = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.hidden || !['hit', 'reading', 'queued', 'trail'].includes(node.state)) continue;
      let parentId = node.parentId;
      while (parentId && !protectedIds.has(parentId)) {
        protectedIds.add(parentId);
        parentId = this.nodes.get(parentId)?.parentId ?? null;
      }
    }
    return protectedIds;
  }

  private scheduleCleanup(): void {
    const protectedIds = this.protectedAncestors();
    for (const [id, el] of this.els) {
      const node = this.nodes.get(id)!;
      const removable = ['ruled-out', 'not-followed', 'unreadable'].includes(node.state) && !protectedIds.has(id);
      el.g.setAttribute('class', `node ${node.state}${removable ? ' collecting' : ''}`);
      if (!removable) {
        clearTimeout(this.cleanup.get(id));
        this.cleanup.delete(id);
      } else if (!this.cleanup.has(id)) {
        const delay = 500 + Math.random() * 500;
        el.g.style.setProperty('--cleanup-delay', `${delay}ms`);
        this.cleanup.set(id, setTimeout(() => this.collect(id), delay));
      }
    }
  }

  private collect(id: string, force = false): void {
    clearTimeout(this.cleanup.get(id));
    this.cleanup.delete(id);
    if (!force && this.protectedAncestors().has(id)) { this.scheduleCleanup(); return; }
    this.collected.add(id);
    this.els.get(id)?.g.remove();
    this.els.get(id)?.line?.remove();
    this.els.delete(id);
    this.scheduleCleanup();
    this.layout();
  }

  private visibleParent(n: TreeNode): string | null {
    let id = n.parentId;
    const seen = new Set<string>([n.id]);
    while (id && !seen.has(id)) {
      if (this.els.has(id)) return id;
      seen.add(id);
      id = this.nodes.get(id)?.parentId ?? null;
    }
    return null;
  }

  private layout(): void {
    // Leaf-order layout: each leaf takes the next row; parents sit at their children's middle.
    const kids = new Map<string | null, TreeNode[]>();
    for (const id of this.els.keys()) {
      const n = this.nodes.get(id)!;
      const parent = this.visibleParent(n);
      const k = kids.get(parent) ?? [];
      k.push(n);
      kids.set(parent, k);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let row = 0;
    const place = (n: TreeNode, depth: number): number => {
      const ch = kids.get(n.id) ?? [];
      const y = ch.length ? ch.map((child) => place(child, depth + 1)).reduce((a, b) => a + b, 0) / ch.length : row++ * DY;
      pos.set(n.id, { x: depth * DX, y });
      return y;
    };
    (kids.get(null) ?? []).forEach((n) => place(n, 0));

    this.svg.style.minHeight = `${row * DY + 40}px`;
    this.svg.style.minWidth = `${Math.max(...[...pos.values()].map((p) => p.x), 0) + 260}px`;

    const h = this.host.clientHeight;
    const offY = Math.max(20, h / 2 - (row * DY) / 2);
    for (const [id, p] of pos) {
      const el = this.els.get(id)!;
      el.g.setAttribute('transform', `translate(${24 + p.x}, ${offY + p.y})`);
      const parentId = this.visibleParent(this.nodes.get(id)!);
      const pp = parentId ? pos.get(parentId) : undefined;
      if (el.line) el.line.style.display = pp ? '' : 'none';
      if (el.line && pp) {
        el.line.setAttribute('x1', String(24 + pp.x));
        el.line.setAttribute('y1', String(offY + pp.y));
        el.line.setAttribute('x2', String(24 + p.x));
        el.line.setAttribute('y2', String(offY + p.y));
      }
    }
  }
}

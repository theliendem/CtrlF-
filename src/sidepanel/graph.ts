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

  constructor(private host: HTMLElement, private onClick: (id: string) => void) {
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('graph-svg');
    this.edges = document.createElementNS(SVG, 'g');
    this.dots = document.createElementNS(SVG, 'g');
    this.svg.append(this.edges, this.dots);
    host.append(this.svg);
  }

  reset(): void {
    this.nodes.clear();
    this.els.clear();
    this.edges.replaceChildren();
    this.dots.replaceChildren();
  }

  upsert(n: TreeNode): void {
    this.nodes.set(n.id, n);
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
    (el.g.querySelector('title') as unknown as SVGTitleElement).textContent = `${n.title}\n${n.url}`;
    (el.g.querySelector('circle') as SVGCircleElement).setAttribute('r', n.state === 'queued' ? '4' : '6');
    this.layout();
  }

  private layout(): void {
    // Leaf-order layout: each leaf takes the next row; parents sit at their children's middle.
    const kids = new Map<string | null, TreeNode[]>();
    for (const n of this.nodes.values()) {
      const k = kids.get(n.parentId) ?? [];
      k.push(n);
      kids.set(n.parentId, k);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let row = 0;
    const place = (n: TreeNode): number => {
      const ch = kids.get(n.id) ?? [];
      const y = ch.length ? ch.map(place).reduce((a, b) => a + b, 0) / ch.length : row++ * DY;
      pos.set(n.id, { x: n.depth * DX, y });
      return y;
    };
    (kids.get(null) ?? []).forEach(place);

    const h = this.host.clientHeight;
    const offY = Math.max(20, h / 2 - (row * DY) / 2);
    for (const [id, p] of pos) {
      const el = this.els.get(id)!;
      el.g.setAttribute('transform', `translate(${24 + p.x}, ${offY + p.y})`);
      const parentId = this.nodes.get(id)!.parentId;
      const pp = parentId ? pos.get(parentId) : undefined;
      if (el.line && pp) {
        el.line.setAttribute('x1', String(24 + pp.x));
        el.line.setAttribute('y1', String(offY + pp.y));
        el.line.setAttribute('x2', String(24 + p.x));
        el.line.setAttribute('y2', String(offY + p.y));
      }
    }
  }
}

// Live dig tree: root on the left, children to the right, siblings stacked.
// Positions ease toward their layout targets every frame, so nodes slide in from their parent and the
// tree re-flows without snapping. A camera follows the reading nodes until the user pans or zooms.
import type { TreeNode } from '../shared/types';

const SVG = 'http://www.w3.org/2000/svg';
const DX = 96;
const DY = 24;
/** Easing time constants (ms): smaller is snappier. */
const NODE_TAU = 160;
const CAM_TAU = 420;
/** How long a user pan/zoom pauses the follow camera. */
const MANUAL_MS = 5000;
const LABEL_MAX = 30;
const GRAY = new Set(['ruled-out', 'not-followed', 'unreadable']);

/** Results-list color by strength: red just over the cutoff, green for the closest matches. Graph nodes stay plain green. */
export function strengthColor(strength = 1): string {
  return `hsl(${Math.round(120 * Math.max(0, Math.min(1, strength)))} 72% 48%)`;
}

interface El {
  g: SVGGElement;
  label: SVGTextElement;
  tip: SVGTitleElement;
  edge?: SVGPathElement;
  x: number; y: number; // current, tree coordinates
  tx: number; ty: number; // layout target
}

const raf: ((cb: (t: number) => void) => number) | undefined = (globalThis as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame?.bind(globalThis);

export class Graph {
  private svg: SVGSVGElement;
  private view: SVGGElement;
  private edges: SVGGElement;
  private dots: SVGGElement;
  private nodes = new Map<string, TreeNode>();
  private els = new Map<string, El>();
  private collected = new Set<string>();
  private cleanup = new Map<string, ReturnType<typeof setTimeout>>();
  private host: HTMLElement;
  private onClick: (id: string) => void;
  private cam = { x: 0, y: 0, s: 1 };
  private camTarget = { x: 0, y: 0, s: 1 };
  private manualUntil = 0;
  private frame = 0;
  private last = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;

  constructor(host: HTMLElement, onClick: (id: string) => void) {
    this.host = host;
    this.onClick = onClick;
    this.svg = document.createElementNS(SVG, 'svg');
    this.svg.classList.add('graph-svg');
    this.view = document.createElementNS(SVG, 'g');
    this.edges = document.createElementNS(SVG, 'g');
    this.dots = document.createElementNS(SVG, 'g');
    this.view.append(this.edges, this.dots);
    this.svg.append(this.view);
    host.append(this.svg);
    this.bindCamera();
  }

  reset(): void {
    for (const timer of this.cleanup.values()) clearTimeout(timer);
    this.cleanup.clear();
    this.collected.clear();
    this.nodes.clear();
    this.els.clear();
    this.edges.replaceChildren();
    this.dots.replaceChildren();
    this.manualUntil = 0;
    this.cam = { x: 0, y: 0, s: 1 };
    this.camTarget = { x: 0, y: 0, s: 1 };
  }

  upsert(n: TreeNode): void {
    // Keep ancestry metadata even when its circle is gone: children may arrive later.
    this.nodes.set(n.id, n);
    const gray = GRAY.has(n.state);
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
      el = this.create(n);
      this.els.set(n.id, el);
    }
    el.label.textContent = n.state === 'hit' ? short(n.title) : '';
    el.tip.textContent = `${n.title}\n${n.url}\n${n.state}${n.state === 'hit' ? ` · score ${n.best.toFixed(2)}` : ''}${n.state === 'unreadable' ? `: ${n.snippet ?? ''}` : ''}`;
    this.scheduleCleanup();
    this.layout();
  }

  private create(n: TreeNode): El {
    const g = document.createElementNS(SVG, 'g');
    const halo = document.createElementNS(SVG, 'circle');
    const dot = document.createElementNS(SVG, 'circle');
    const label = document.createElementNS(SVG, 'text');
    const tip = document.createElementNS(SVG, 'title');
    halo.setAttribute('class', 'halo');
    halo.setAttribute('r', '6');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('r', '6');
    label.setAttribute('x', '10');
    label.setAttribute('y', '4');
    g.append(halo, dot, label, tip);
    g.addEventListener('click', () => {
      if (this.suppressClick) return;
      this.onClick(n.id);
    });
    this.dots.append(g);
    let edge: SVGPathElement | undefined;
    if (n.parentId) {
      edge = document.createElementNS(SVG, 'path');
      this.edges.append(edge);
    }
    // Slide in from the nearest visible ancestor's current position.
    const parent = this.els.get(this.visibleParent(n) ?? '');
    const x = parent?.x ?? 0;
    const y = parent?.y ?? 0;
    return { g, label, tip, edge, x, y, tx: x, ty: y };
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

  /** Every ancestor of a hit shows as a faint green trail, whatever its own result. */
  private trailIds(): Set<string> {
    const trail = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.state !== 'hit' || node.hidden) continue;
      let parentId = node.parentId;
      while (parentId && !trail.has(parentId)) {
        trail.add(parentId);
        parentId = this.nodes.get(parentId)?.parentId ?? null;
      }
    }
    return trail;
  }

  private scheduleCleanup(): void {
    const protectedIds = this.protectedAncestors();
    const trail = this.trailIds();
    for (const [id, el] of this.els) {
      const node = this.nodes.get(id)!;
      const removable = GRAY.has(node.state) && !protectedIds.has(id);
      const shown = node.state !== 'hit' && trail.has(id) ? 'trail' : node.state;
      const cls = `${shown}${removable ? ' collecting' : ''}`;
      el.g.setAttribute('class', `node ${cls}`);
      el.edge?.setAttribute('class', `edge ${cls}`);
      if (!removable) {
        clearTimeout(this.cleanup.get(id));
        this.cleanup.delete(id);
      } else if (!this.cleanup.has(id)) {
        const delay = 500 + Math.random() * 500;
        el.g.style.setProperty('--cleanup-delay', `${delay}ms`);
        el.edge?.style.setProperty('--cleanup-delay', `${delay}ms`);
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
    this.els.get(id)?.edge?.remove();
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
    let row = 0;
    const place = (n: TreeNode, depth: number): number => {
      const ch = kids.get(n.id) ?? [];
      const y = ch.length ? ch.map((child) => place(child, depth + 1)).reduce((a, b) => a + b, 0) / ch.length : row++ * DY;
      const el = this.els.get(n.id)!;
      el.tx = depth * DX;
      el.ty = y;
      // A label to the right would sit on the node's own edges, so parents label above themselves.
      const above = ch.length > 0;
      el.label.setAttribute('x', above ? '0' : '10');
      el.label.setAttribute('y', above ? '-10' : '4');
      el.label.setAttribute('text-anchor', above ? 'middle' : 'start');
      return y;
    };
    (kids.get(null) ?? []).forEach((n) => place(n, 0));
    this.aimCamera();
    this.kick();
  }

  // ---------- Camera ----------

  private size(): { w: number; h: number } {
    return { w: this.host.clientWidth || 320, h: this.host.clientHeight || 400 };
  }

  /** Fit the whole tree when it fits legibly; otherwise centre on the nodes being read. */
  private aimCamera(): void {
    if (performance.now() < this.manualUntil || !this.els.size) return;
    const { w, h } = this.size();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const active: El[] = [];
    for (const [id, el] of this.els) {
      minX = Math.min(minX, el.tx); maxX = Math.max(maxX, el.tx);
      minY = Math.min(minY, el.ty); maxY = Math.max(maxY, el.ty);
      if (this.nodes.get(id)?.state === 'reading') active.push(el);
    }
    const padX = 24, padY = 24, labelRoom = 170;
    const fit = Math.min(w / (maxX - minX + labelRoom + padX * 2), h / (maxY - minY + padY * 2), 1.15);
    const floor = active.length ? 0.6 : 0.3; // stay legible while digging; show it all once done
    const s = Math.max(fit, floor);
    let cx = (minX + maxX + labelRoom - padX) / 2;
    let cy = (minY + maxY) / 2;
    if (fit < floor && active.length) {
      cx = active.reduce((a, el) => a + el.tx, 0) / active.length;
      cy = active.reduce((a, el) => a + el.ty, 0) / active.length;
      // Don't scroll past the tree's edges.
      const halfW = w / (2 * s), halfH = h / (2 * s);
      cx = clamp(cx, minX - padX + halfW, Math.max(minX - padX + halfW, maxX + labelRoom - halfW));
      cy = clamp(cy, minY - padY + halfH, Math.max(minY - padY + halfH, maxY + padY - halfH));
    }
    this.camTarget = { x: cx, y: cy, s };
  }

  private bindCamera(): void {
    const svg = this.svg as unknown as HTMLElement;
    const manual = (): void => { this.manualUntil = performance.now() + MANUAL_MS; };
    svg.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      manual();
      const { w, h } = this.size();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left - w / 2, py = e.clientY - rect.top - h / 2;
      const s = clamp(this.camTarget.s * Math.exp(-e.deltaY * 0.0015), 0.15, 2.5);
      // Keep the point under the cursor fixed while zooming.
      const wx = this.camTarget.x + px / this.camTarget.s, wy = this.camTarget.y + py / this.camTarget.s;
      this.camTarget = { x: wx - px / s, y: wy - py / s, s };
      this.kick();
    }, { passive: false });
    svg.addEventListener('pointerdown', (e: PointerEvent) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.suppressClick = false;
    });
    svg.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!this.drag.moved) svg.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, moved: true };
      manual();
      this.camTarget = { ...this.camTarget, x: this.camTarget.x - dx / this.camTarget.s, y: this.camTarget.y - dy / this.camTarget.s };
      this.cam = { ...this.cam, x: this.cam.x - dx / this.cam.s, y: this.cam.y - dy / this.cam.s };
      svg.classList.add('panning');
      this.kick();
    });
    const end = (): void => {
      if (this.drag?.moved) this.suppressClick = true;
      this.drag = null;
      svg.classList.remove('panning');
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    // Double-click empty space to hand control back to the follow camera.
    svg.addEventListener('dblclick', () => { this.manualUntil = 0; this.aimCamera(); this.kick(); });
  }

  // ---------- Animation ----------

  private kick(): void {
    if (!raf) { this.step(Infinity); return; } // tests and non-browser hosts: jump to targets
    if (this.frame) return;
    this.last = performance.now();
    this.frame = raf((t) => this.tick(t));
  }

  private tick(t: number): void {
    this.frame = 0;
    const dt = Math.min(64, Math.max(0, t - this.last));
    this.last = t;
    // Re-aim once the manual pause runs out.
    if (this.manualUntil && t >= this.manualUntil) { this.manualUntil = 0; this.aimCamera(); }
    if (this.step(dt) || this.manualUntil) this.frame = raf!((next) => this.tick(next));
  }

  /** Advance every position by dt ms. Returns true while anything is still moving. */
  private step(dt: number): boolean {
    const k = 1 - Math.exp(-dt / NODE_TAU);
    const kc = 1 - Math.exp(-dt / CAM_TAU);
    let moving = false;
    for (const el of this.els.values()) {
      el.x += (el.tx - el.x) * k;
      el.y += (el.ty - el.y) * k;
      if (Math.abs(el.tx - el.x) > 0.2 || Math.abs(el.ty - el.y) > 0.2) moving = true;
      else { el.x = el.tx; el.y = el.ty; }
    }
    for (const [id, el] of this.els) {
      el.g.setAttribute('transform', `translate(${el.x.toFixed(1)},${el.y.toFixed(1)})`);
      if (!el.edge) continue;
      const parent = this.els.get(this.visibleParent(this.nodes.get(id)!) ?? '');
      if (!parent) { el.edge.setAttribute('d', ''); continue; }
      const mx = (parent.x + el.x) / 2;
      el.edge.setAttribute('d', `M${parent.x.toFixed(1)},${parent.y.toFixed(1)} C${mx.toFixed(1)},${parent.y.toFixed(1)} ${mx.toFixed(1)},${el.y.toFixed(1)} ${el.x.toFixed(1)},${el.y.toFixed(1)}`);
    }
    const c = this.cam, ct = this.camTarget;
    c.x += (ct.x - c.x) * kc;
    c.y += (ct.y - c.y) * kc;
    c.s += (ct.s - c.s) * kc;
    if (Math.abs(ct.x - c.x) > 0.3 || Math.abs(ct.y - c.y) > 0.3 || Math.abs(ct.s - c.s) > 0.002) moving = true;
    const { w, h } = this.size();
    const oy = h / 2 - c.y * c.s;
    this.view.setAttribute('transform', `translate(${(w / 2 - c.x * c.s).toFixed(1)},${oy.toFixed(1)}) scale(${c.s.toFixed(3)})`);
    // Notebook rules: one per tree row, moving with the camera; they fade out when zoomed too far to read.
    const gap = DY * c.s;
    this.host.style.setProperty('--rule-gap', `${gap.toFixed(2)}px`);
    this.host.style.setProperty('--rule-y', `${(((oy % gap) + gap) % gap).toFixed(1)}px`);
    this.host.style.setProperty('--rule-alpha', clamp((gap - 9) / 9, 0, 1).toFixed(2));
    return moving;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function short(title: string): string {
  return title.length > LABEL_MAX ? `${title.slice(0, LABEL_MAX - 1)}…` : title;
}

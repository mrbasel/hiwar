// The episode map's canvas: every episode at its 2D position from
// `pipeline.map`, coloured by cluster or channel, panned and zoomed by hand.
// It redraws on its own animation frames; React only tells it what changed.

import type { MapCluster, MapData } from "#api/map";
import { fold } from "#lib/format";

export interface Point {
  id: string;
  x: number;
  y: number;
  cluster: number;
  channel: number;
  title: string;
  date: string;
  norm: string; // folded title, for filtering
}

export type ColourBy = "cluster" | "channel";

export interface MapModel {
  model: string;
  points: Point[];
  clusters: Map<number, MapCluster>;
  channels: string[];
}

interface View {
  s: number; // screen = offset + map * scale
  ox: number;
  oy: number;
}

const NOISE = "rgba(150, 160, 175, 0.35)";
const DIM = "rgba(150, 160, 175, 0.1)";
const GRID = 100; // hover lookup cells per axis, in map units of 1/GRID

export function prepare(data: MapData): MapModel {
  return {
    model: data.model,
    channels: data.channels,
    clusters: new Map(data.clusters.map((c) => [c.id, c])),
    points: data.points.map(([id, x, y, cluster, channel, title, date]) => ({
      id,
      x,
      y,
      cluster,
      channel,
      title,
      date,
      norm: fold(title),
    })),
  };
}

export function episodeUrl(p: Point): string {
  return `https://www.youtube.com/watch?v=${p.id}`;
}

function hue(n: number): number {
  return (n * 137.508) % 360; // golden angle: neighbouring ids get distant hues
}

export function clusterColour(id: number): string {
  return id === -1 ? NOISE : `hsl(${hue(id)}, 70%, 60%)`;
}

export function colourOf(p: Point, by: ColourBy): string {
  return by === "channel" ? `hsl(${hue(p.channel)}, 65%, 60%)` : clusterColour(p.cluster);
}

function cell(v: number): number {
  return Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class MapEngine {
  colourBy: ColourBy = "cluster";
  private matches: Set<Point> | null = null; // null for no filter
  private activeCluster: number | null = null;
  private selected: Point | null = null;
  private hovered: Point | null = null;

  private ctx: CanvasRenderingContext2D;
  private grid: Point[][];
  private view: View = { s: 1, ox: 0, oy: 0 };
  private home: View = this.view;
  private dirty = true;
  private frame = 0;
  private drag: { x: number; y: number; ox: number; oy: number; moved: boolean } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private tip: HTMLElement,
    private model: MapModel,
    private onSelect: (p: Point | null) => void,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas");
    this.ctx = ctx;

    this.grid = Array.from({ length: GRID * GRID }, () => []);
    for (const p of model.points) this.grid[cell(p.x) * GRID + cell(p.y)]?.push(p);

    this.resize();
    this.home = this.fit(0, 0, 1, 1);
    this.view = this.home;
    this.listen();

    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.draw();
      }
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    for (const off of this.cleanup) off();
  }

  // State from the panel

  setColourBy(by: ColourBy) {
    this.colourBy = by;
    this.dirty = true;
  }

  setMatches(matches: Set<Point> | null) {
    this.matches = matches;
    this.dirty = true;
  }

  setSelected(p: Point | null, { fly = false } = {}) {
    this.selected = p;
    this.dirty = true;
    if (p && fly) {
      const zoom = Math.max(this.view.s, this.home.s * 6);
      const { w, h } = this.size();
      this.flyTo({ s: zoom, ox: w / 2 - p.x * zoom, oy: h / 2 - p.y * zoom });
    }
  }

  // Zooms to the cluster, or back out to the whole map for null.
  setActiveCluster(id: number | null) {
    if (id === this.activeCluster) return;
    this.activeCluster = id;
    this.dirty = true;
    if (id === null) {
      this.flyTo(this.home);
      return;
    }
    const members = this.model.points.filter((p) => p.cluster === id);
    const xs = members.map((p) => p.x);
    const ys = members.map((p) => p.y);
    this.flyTo(this.fit(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
  }

  isActive(p: Point): boolean {
    if (this.matches && !this.matches.has(p)) return false;
    if (this.activeCluster !== null && p.cluster !== this.activeCluster) return false;
    return true;
  }

  // View

  private size() {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  private fit(x0: number, y0: number, x1: number, y1: number): View {
    const { w, h } = this.size();
    const s = Math.min(w / Math.max(x1 - x0, 0.02), h / Math.max(y1 - y0, 0.02)) * 0.88;
    return { s, ox: w / 2 - ((x0 + x1) / 2) * s, oy: h / 2 - ((y0 + y1) / 2) * s };
  }

  private centre(v: View) {
    const { w, h } = this.size();
    return { x: (w / 2 - v.ox) / v.s, y: (h / 2 - v.oy) / v.s };
  }

  private flyTo(target: View) {
    const from = this.view;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 350);
      const e = 1 - (1 - t) ** 3;
      // Interpolate the scale geometrically so zooming feels even.
      const s = from.s * (target.s / from.s) ** e;
      const cx = lerp(this.centre(from).x, this.centre(target).x, e);
      const cy = lerp(this.centre(from).y, this.centre(target).y, e);
      const { w, h } = this.size();
      this.view = { s, ox: w / 2 - cx * s, oy: h / 2 - cy * s };
      this.dirty = true;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private toScreen(p: { x: number; y: number }): [number, number] {
    return [this.view.ox + p.x * this.view.s, this.view.oy + p.y * this.view.s];
  }

  private resize() {
    const ratio = devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * ratio;
    this.canvas.height = this.canvas.clientHeight * ratio;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.dirty = true;
  }

  // Drawing

  private draw() {
    const { ctx } = this;
    const { w, h } = this.size();
    ctx.clearRect(0, 0, w, h);
    const r = Math.min(5, Math.max(1.6, 1.6 * Math.sqrt(this.view.s / this.home.s)));
    const highlighting = this.matches !== null || this.activeCluster !== null;

    // Batch by colour: one path per fill style, dimmed points first.
    const batches = new Map<string, Point[]>();
    const add = (style: string, p: Point) => {
      const batch = batches.get(style);
      if (batch) batch.push(p);
      else batches.set(style, [p]);
    };
    for (const p of this.model.points) {
      if (highlighting && !this.isActive(p)) add(DIM, p);
    }
    for (const p of this.model.points) {
      if (!highlighting || this.isActive(p)) add(colourOf(p, this.colourBy), p);
    }
    for (const [style, group] of batches) {
      const pr = style === DIM ? r * 0.8 : highlighting ? r * 1.3 : r;
      ctx.fillStyle = style;
      ctx.beginPath();
      for (const p of group) {
        const [x, y] = this.toScreen(p);
        if (x < -pr || y < -pr || x > w + pr || y > h + pr) continue;
        ctx.moveTo(x + pr, y);
        ctx.arc(x, y, pr, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    this.drawLabels(w, h);

    for (const [p, colour] of [
      [this.hovered, "#fff"],
      [this.selected, "#ffe27a"],
    ] as const) {
      if (!p) continue;
      const [x, y] = this.toScreen(p);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Biggest clusters first; skip any label that would overlap one already drawn.
  private drawLabels(w: number, h: number) {
    const { ctx } = this;
    ctx.font = "600 13px 'IBM Plex Sans Arabic', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...this.model.clusters.values()].sort((a, b) => b.size - a.size);
    for (const c of order) {
      if (this.activeCluster !== null && c.id !== this.activeCluster) continue;
      const [x, y] = this.toScreen(c);
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const text = c.label.split(" · ").slice(0, 2).join(" · ");
      const tw = ctx.measureText(text).width + 8;
      const box = { x0: x - tw / 2, x1: x + tw / 2, y0: y - 10, y1: y + 10 };
      if (placed.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
      placed.push(box);
      ctx.strokeStyle = "rgba(15, 21, 29, 0.85)";
      ctx.lineWidth = 4;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x, y);
    }
  }

  // Hover and input

  private nearest(sx: number, sy: number, maxPx = 8): Point | null {
    const mx = (sx - this.view.ox) / this.view.s;
    const my = (sy - this.view.oy) / this.view.s;
    const reach = maxPx / this.view.s;
    const filtering = this.matches !== null || this.activeCluster !== null;
    let best: Point | null = null;
    let bestD = reach * reach;
    for (let i = cell(mx - reach); i <= cell(mx + reach); i++) {
      for (let j = cell(my - reach); j <= cell(my + reach); j++) {
        for (const p of this.grid[i * GRID + j] ?? []) {
          if (filtering && !this.isActive(p)) continue;
          const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
          if (d < bestD) [best, bestD] = [p, d];
        }
      }
    }
    return best;
  }

  private showTip(p: Point | null, sx: number, sy: number) {
    const { tip } = this;
    if (!p) {
      tip.hidden = true;
      return;
    }
    const cluster = this.model.clusters.get(p.cluster);
    const title = document.createElement("strong");
    title.textContent = p.title;
    title.dir = "auto";
    const meta = document.createElement("span");
    meta.textContent = `${this.model.channels[p.channel]} · ${p.date}`;
    const group = document.createElement("span");
    group.textContent = cluster ? cluster.label : "بلا مجموعة";
    tip.replaceChildren(title, meta, document.createElement("br"), group);
    tip.hidden = false;

    const stage = this.canvas.getBoundingClientRect();
    const left = Math.min(sx + 14, stage.width - tip.offsetWidth - 8);
    const top = sy + 14 + tip.offsetHeight > stage.height ? sy - tip.offsetHeight - 10 : sy + 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${top}px`;
  }

  private listen() {
    const { canvas } = this;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, handler, options);
      this.cleanup.push(() => canvas.removeEventListener(type, handler, options));
    };

    on("pointerdown", (e) => {
      this.drag = { x: e.offsetX, y: e.offsetY, ox: this.view.ox, oy: this.view.oy, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });

    on("pointermove", (e) => {
      const { drag } = this;
      if (drag) {
        const dx = e.offsetX - drag.x;
        const dy = e.offsetY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          canvas.dataset.dragging = "";
          this.view = { ...this.view, ox: drag.ox + dx, oy: drag.oy + dy };
          this.tip.hidden = true;
          this.dirty = true;
          return;
        }
      }
      const p = this.nearest(e.offsetX, e.offsetY);
      if (p !== this.hovered) {
        this.hovered = p;
        this.dirty = true;
      }
      if (p) canvas.dataset.overPoint = "";
      else delete canvas.dataset.overPoint;
      this.showTip(p, e.offsetX, e.offsetY);
    });

    on("pointerup", (e) => {
      delete canvas.dataset.dragging;
      if (this.drag && !this.drag.moved) {
        const p = this.nearest(e.offsetX, e.offsetY);
        this.setSelected(p);
        this.onSelect(p);
      }
      this.drag = null;
    });

    on("pointerleave", () => {
      this.hovered = null;
      this.tip.hidden = true;
      this.dirty = true;
    });

    on("dblclick", () => {
      if (this.selected) open(episodeUrl(this.selected), "_blank", "noopener");
    });

    on(
      "wheel",
      (e) => {
        e.preventDefault();
        const { view, home } = this;
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        const s = Math.min(home.s * 80, Math.max(home.s * 0.5, view.s * factor));
        const k = s / view.s;
        this.view = {
          s,
          ox: e.offsetX - (e.offsetX - view.ox) * k,
          oy: e.offsetY - (e.offsetY - view.oy) * k,
        };
        this.tip.hidden = true;
        this.dirty = true;
      },
      { passive: false },
    );

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    this.cleanup.push(() => observer.disconnect());
  }
}

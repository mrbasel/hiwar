// The episode map: every episode at its 2D position from `pipeline.map`,
// coloured by cluster or channel, on a canvas that pans and zooms.

const $ = (sel) => document.querySelector(sel);
const canvas = $("#map");
const ctx = canvas.getContext("2d");
const tip = $("#tip");
const status = $("#status");
const filterInput = $("#filter");
const count = $("#count");

const arabicNumber = new Intl.NumberFormat("ar");
const NOISE = "rgba(150, 160, 175, 0.35)";
const DIM = "rgba(150, 160, 175, 0.1)";
const GRID = 100; // hover lookup cells per axis, in map units of 1/GRID

let points = []; // {id, x, y, cluster, channel, title, date, norm}
let clusters = new Map(); // id -> {id, label, size, x, y}
let channels = [];
let grid = [];
let colourBy = "cluster";
let view = { s: 1, ox: 0, oy: 0 }; // screen = offset + map * scale
let home = view;
let hovered = null;
let selected = null; // a point
let activeCluster = null;
let matches = null; // Set of points matching the filter, or null for no filter
let dirty = true;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Match pipeline.map's normalisation, so "مقدمة" finds "مقدمه".
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function hue(n) {
  return (n * 137.508) % 360; // golden angle: neighbouring ids get distant hues
}

function colourOf(p) {
  if (colourBy === "channel") return `hsl(${hue(p.channel)}, 65%, 60%)`;
  return p.cluster === -1 ? NOISE : `hsl(${hue(p.cluster)}, 70%, 60%)`;
}

function episodeUrl(p) {
  return `https://www.youtube.com/watch?v=${p.id}`;
}

// Loading

async function load() {
  const res = await fetch("/api/map");
  const data = await res.json();
  if (!res.ok) {
    status.textContent = data.error;
    return;
  }
  channels = data.channels;
  points = data.points.map(([id, x, y, cluster, channel, title, date]) => ({
    id, x, y, cluster, channel, title, date, norm: normalize(title),
  }));
  for (const c of data.clusters) clusters.set(c.id, c);

  grid = Array.from({ length: GRID * GRID }, () => []);
  for (const p of points) grid[cell(p.x) * GRID + cell(p.y)].push(p);

  status.textContent = `${arabicNumber.format(points.length)} حلقة، ${arabicNumber.format(clusters.size)} مجموعة (${data.model})`;
  renderClusterList();
  resize();
  home = fit(0, 0, 1, 1);
  view = home;
  dirty = true;
}

function cell(v) {
  return Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
}

// View

function fit(x0, y0, x1, y1) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const s = Math.min(w / Math.max(x1 - x0, 0.02), h / Math.max(y1 - y0, 0.02)) * 0.88;
  return { s, ox: w / 2 - ((x0 + x1) / 2) * s, oy: h / 2 - ((y0 + y1) / 2) * s };
}

function flyTo(target) {
  const from = view;
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 350);
    const e = 1 - (1 - t) ** 3;
    // Interpolate the scale geometrically so zooming feels even.
    const s = from.s * (target.s / from.s) ** e;
    const cx = lerp(centre(from).x, centre(target).x, e);
    const cy = lerp(centre(from).y, centre(target).y, e);
    view = { s, ox: canvas.clientWidth / 2 - cx * s, oy: canvas.clientHeight / 2 - cy * s };
    dirty = true;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function centre(v) {
  return { x: (canvas.clientWidth / 2 - v.ox) / v.s, y: (canvas.clientHeight / 2 - v.oy) / v.s };
}

function toScreen(p) {
  return [view.ox + p.x * view.s, view.oy + p.y * view.s];
}

function resize() {
  const ratio = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  dirty = true;
}

// Drawing

function isActive(p) {
  if (matches && !matches.has(p)) return false;
  if (activeCluster !== null && p.cluster !== activeCluster) return false;
  return true;
}

function draw() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  const r = Math.min(5, Math.max(1.6, 1.6 * Math.sqrt(view.s / home.s)));
  const highlighting = matches !== null || activeCluster !== null;

  // Batch by colour: one path per fill style.
  const batches = new Map();
  const add = (style, p) => {
    if (!batches.has(style)) batches.set(style, []);
    batches.get(style).push(p);
  };
  for (const p of points) {
    if (highlighting && !isActive(p)) add(DIM, p);
  }
  for (const p of points) {
    if (!highlighting || isActive(p)) add(colourOf(p), p);
  }
  const radius = (style) => (style === DIM ? r * 0.8 : highlighting ? r * 1.3 : r);
  for (const [style, group] of batches) {
    ctx.fillStyle = style;
    ctx.beginPath();
    const pr = radius(style);
    for (const p of group) {
      const [x, y] = toScreen(p);
      if (x < -pr || y < -pr || x > w + pr || y > h + pr) continue;
      ctx.moveTo(x + pr, y);
      ctx.arc(x, y, pr, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  drawLabels(w, h);

  for (const [p, colour] of [[hovered, "#fff"], [selected, "#ffe27a"]]) {
    if (!p) continue;
    const [x, y] = toScreen(p);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Biggest clusters first; skip any label that would overlap one already drawn.
function drawLabels(w, h) {
  ctx.font = "600 13px 'IBM Plex Sans Arabic', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  const placed = [];
  const order = [...clusters.values()].sort((a, b) => b.size - a.size);
  for (const c of order) {
    if (activeCluster !== null && c.id !== activeCluster) continue;
    const [x, y] = toScreen(c);
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

function frame() {
  if (dirty) {
    dirty = false;
    draw();
  }
  requestAnimationFrame(frame);
}

// Hover and selection

function nearest(sx, sy, maxPx = 8) {
  const mx = (sx - view.ox) / view.s;
  const my = (sy - view.oy) / view.s;
  const reach = maxPx / view.s;
  let best = null;
  let bestD = reach * reach;
  for (let i = cell(mx - reach); i <= cell(mx + reach); i++) {
    for (let j = cell(my - reach); j <= cell(my + reach); j++) {
      for (const p of grid[i * GRID + j]) {
        if ((matches || activeCluster !== null) && !isActive(p)) continue;
        const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
        if (d < bestD) [best, bestD] = [p, d];
      }
    }
  }
  return best;
}

function showTip(p, sx, sy) {
  if (!p) {
    tip.hidden = true;
    return;
  }
  const cluster = clusters.get(p.cluster);
  tip.replaceChildren(
    el("strong", { textContent: p.title, dir: "auto" }),
    el("span", { textContent: `${channels[p.channel]} · ${p.date}` }),
    el("br"),
    el("span", { textContent: cluster ? cluster.label : "بلا مجموعة" }),
  );
  tip.hidden = false;
  const stage = canvas.getBoundingClientRect();
  const left = Math.min(sx + 14, stage.width - tip.offsetWidth - 8);
  const top = sy + 14 + tip.offsetHeight > stage.height ? sy - tip.offsetHeight - 10 : sy + 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}

function select(p, { fly = false } = {}) {
  selected = p;
  dirty = true;
  $("#selected").hidden = !p;
  if (!p) return;
  const link = $("#sel-title");
  link.textContent = p.title;
  link.dir = "auto";
  link.href = episodeUrl(p);
  $("#sel-meta").textContent = `${channels[p.channel]} · ${p.date}`;
  const cluster = clusters.get(p.cluster);
  $("#sel-cluster").textContent = cluster ? `المجموعة: ${cluster.label}` : "بلا مجموعة";

  const near = points
    .filter((q) => q !== p)
    .map((q) => [q, (q.x - p.x) ** 2 + (q.y - p.y) ** 2])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 10);
  $("#neighbours").replaceChildren(
    ...near.map(([q]) =>
      el("li", {}, [
        el("button", { type: "button", onclick: () => select(q, { fly: true }) }, [
          el("span", { className: "swatch", style: `background:${colourOf(q)}` }),
          el("span", { textContent: q.title, dir: "auto" }),
        ]),
      ]),
    ),
  );
  if (fly) {
    const zoom = Math.max(view.s, home.s * 6);
    flyTo({ s: zoom, ox: canvas.clientWidth / 2 - p.x * zoom, oy: canvas.clientHeight / 2 - p.y * zoom });
  }
}

// Clusters list

function renderClusterList() {
  const order = [...clusters.values()].sort((a, b) => b.size - a.size);
  $("#clusters").replaceChildren(
    ...order.map((c) =>
      el("li", {}, [
        el("button", { type: "button", value: c.id, onclick: () => toggleCluster(c.id) }, [
          el("span", { className: "swatch", style: `background:hsl(${hue(c.id)}, 70%, 60%)` }),
          el("span", { className: "label", textContent: c.label, dir: "auto" }),
          el("span", { className: "size", textContent: arabicNumber.format(c.size) }),
        ]),
      ]),
    ),
  );
}

function toggleCluster(id) {
  activeCluster = activeCluster === id ? null : id;
  for (const b of $("#clusters").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String(Number(b.value) === activeCluster));
  }
  if (activeCluster === null) {
    flyTo(home);
  } else {
    const members = points.filter((p) => p.cluster === id);
    const xs = members.map((p) => p.x);
    const ys = members.map((p) => p.y);
    flyTo(fit(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
  }
  updateCount();
  dirty = true;
}

function updateCount() {
  if (!matches) {
    count.textContent = "";
    return;
  }
  const shown = activeCluster === null ? matches.size : [...matches].filter(isActive).length;
  count.textContent = `${arabicNumber.format(shown)} حلقة مطابقة`;
}

// Input

let drag = null;

canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.offsetX, y: e.offsetY, ox: view.ox, oy: view.oy, moved: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (drag) {
    const dx = e.offsetX - drag.x;
    const dy = e.offsetY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      canvas.classList.add("dragging");
      view = { ...view, ox: drag.ox + dx, oy: drag.oy + dy };
      tip.hidden = true;
      dirty = true;
      return;
    }
  }
  const p = nearest(e.offsetX, e.offsetY);
  if (p !== hovered) {
    hovered = p;
    dirty = true;
  }
  canvas.classList.toggle("over-point", !!p);
  showTip(p, e.offsetX, e.offsetY);
});

canvas.addEventListener("pointerup", (e) => {
  canvas.classList.remove("dragging");
  if (drag && !drag.moved) select(nearest(e.offsetX, e.offsetY));
  drag = null;
});

canvas.addEventListener("pointerleave", () => {
  hovered = null;
  tip.hidden = true;
  dirty = true;
});

canvas.addEventListener("dblclick", () => {
  if (selected) open(episodeUrl(selected), "_blank", "noopener");
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    const s = Math.min(home.s * 80, Math.max(home.s * 0.5, view.s * factor));
    const k = s / view.s;
    view = { s, ox: e.offsetX - (e.offsetX - view.ox) * k, oy: e.offsetY - (e.offsetY - view.oy) * k };
    tip.hidden = true;
    dirty = true;
  },
  { passive: false },
);

let filterTimer;
filterInput.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    const terms = normalize(filterInput.value).split(/\s+/).filter(Boolean);
    matches = terms.length ? new Set(points.filter((p) => terms.every((t) => p.norm.includes(t)))) : null;
    updateCount();
    dirty = true;
  }, 120);
});

for (const radio of document.querySelectorAll("input[name=colour]")) {
  radio.addEventListener("change", () => {
    colourBy = radio.value;
    if (selected) select(selected); // refresh the neighbour swatches
    dirty = true;
  });
}

addEventListener("resize", resize);
addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    select(null);
    if (activeCluster !== null) toggleCluster(activeCluster);
  }
});

requestAnimationFrame(frame);
load();

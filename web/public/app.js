const $ = (sel) => document.querySelector(sel);
const form = $("#search");
const input = $("#q");
const keywordOnly = $("#keyword");
const status = $("#status");
const results = $("#results");
const pager = $("#pager");
const intro = $("#intro");
const episodeTpl = $("#episode-tpl");

const arabicNumber = new Intl.NumberFormat("ar");
let current = null; // params of the search on screen
const BADGES = { keyword: "Keyword", semantic: "Semantic" };

function clock(seconds) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function timeLink(seconds, href) {
  return el("a", { className: "time", href, target: "_blank", rel: "noopener", textContent: clock(seconds) });
}

// URL state

function fromUrl() {
  const url = new URLSearchParams(location.search);
  return { q: url.get("q") ?? "", page: Number(url.get("page")) || 1, mode: url.get("mode") ?? "hybrid" };
}

function toQueryString(p) {
  const url = new URLSearchParams({ q: p.q });
  if (p.page > 1) url.set("page", p.page);
  if (p.mode === "keyword") url.set("mode", "keyword");
  return url.toString();
}

// Search

async function run(p, { push = true } = {}) {
  current = p;
  if (push) history.pushState(null, "", `?${toQueryString(p)}`);
  intro.hidden = !!p.q;
  if (!p.q) {
    results.replaceChildren();
    pager.hidden = true;
    status.textContent = "";
    return;
  }
  document.title = `${p.q} | بحث في البودكاست`;
  status.className = "status";
  status.textContent = "جارٍ البحث…";

  const res = await fetch(`/api/search?${toQueryString(p)}`);
  const data = await res.json();
  if (current !== p) return; // a newer search started meanwhile
  if (!res.ok) {
    status.className = "status error";
    status.textContent = data.error;
    results.replaceChildren();
    pager.hidden = true;
    return;
  }
  render(data);
}

function render(data) {
  const { total, page, limit, took_ms } = data;
  status.textContent = total
    ? `${arabicNumber.format(total)} حلقة مطابقة (${took_ms} ms)`
    : "لا توجد نتائج. جرّب كلمات أقل، أو تهجئة أخرى للاسم، أو استخدم * للبحث ببداية الكلمة.";

  // Group this page's sections by episode, keeping the order of the best hit.
  const episodes = new Map();
  for (const r of data.results) {
    if (!episodes.has(r.episode.id)) episodes.set(r.episode.id, { episode: r.episode, hits: [] });
    episodes.get(r.episode.id).hits.push(r);
  }
  results.replaceChildren(...[...episodes.values()].map(renderEpisode));

  const pages = Math.ceil(total / limit);
  pager.hidden = pages <= 1;
  $("#page").textContent = `${arabicNumber.format(page)} من ${arabicNumber.format(pages)}`;
  $("#prev").disabled = page <= 1;
  $("#next").disabled = page >= pages;
}

function renderEpisode({ episode, hits }) {
  const node = episodeTpl.content.firstElementChild.cloneNode(true);
  const title = node.querySelector(".ep-title");
  title.innerHTML = episode.title_html;
  title.href = episode.url;
  node.querySelector(".show").textContent = episode.show.trim();
  node.querySelector(".date").textContent = episode.date;
  node.querySelector(".date").dateTime = episode.date;
  if (episode.duration) node.querySelector(".duration").textContent = clock(episode.duration);
  // Hybrid results say which search found them; label the episode with every
  // search that found one of its sections on this page.
  const via = new Set(hits.flatMap((h) => h.matched_by ?? []));
  node.querySelector(".via").append(
    ...["keyword", "semantic"]
      .filter((m) => via.has(m))
      .map((m) => el("span", { className: `badge ${m}`, textContent: BADGES[m] })),
  );

  const sections = node.querySelector(".sections");
  sections.append(...hits.map(renderSection));
  const toggle = node.querySelector(".toggle");
  const showLabel = `اعرض الأجزاء المطابقة (${arabicNumber.format(hits.length)})`;
  toggle.textContent = showLabel;
  toggle.addEventListener("click", () => {
    sections.hidden = !sections.hidden;
    toggle.textContent = sections.hidden ? showLabel : "أخفِ الأجزاء";
    toggle.setAttribute("aria-expanded", String(!sections.hidden));
  });
  return node;
}

function renderSection(hit) {
  const { section } = hit;
  const heading = el("h3", {}, [timeLink(section.start, section.link)]);
  heading.append(el("span", { innerHTML: section.title_html }));

  const body = hit.moments.length
    ? hit.moments.map((m) => {
        const quote = el("p", { className: "quote" });
        quote.innerHTML = `<span class="ctx">${m.before}</span> ${m.html} <span class="ctx">${m.after}</span>`;
        return el("div", { className: "moment" }, [timeLink(m.start, m.link), quote]);
      })
    : [el("p", { className: "snippet", innerHTML: hit.snippet })];

  return el("div", { className: "section" }, [heading, ...body]);
}

// Events

form.addEventListener("submit", (e) => {
  e.preventDefault();
  run({ q: input.value.trim(), page: 1, mode: keywordOnly.checked ? "keyword" : "hybrid" });
});

keywordOnly.addEventListener("change", () => {
  if (input.value.trim()) form.requestSubmit();
});

$("#prev").addEventListener("click", () => {
  run({ ...current, page: current.page - 1 });
  scrollTo(0, 0);
});
$("#next").addEventListener("click", () => {
  run({ ...current, page: current.page + 1 });
  scrollTo(0, 0);
});

addEventListener("popstate", () => {
  const p = fromUrl();
  input.value = p.q;
  keywordOnly.checked = p.mode === "keyword";
  run(p, { push: false });
});

const initial = fromUrl();
input.value = initial.q;
keywordOnly.checked = initial.mode === "keyword";
if (initial.q) run(initial, { push: false });

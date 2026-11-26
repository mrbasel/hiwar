// Search over the vectors in the database (see pipeline/serve_db.py), all
// held in memory: each doc's sign bits find the nearest few by Hamming
// distance, and their int8 vectors rescore those against the query. Docs the
// server adds or deletes while the API runs are picked up by refreshIndex().

import { db } from "../db/connection.js";

const API = "https://openrouter.ai/api/v1/embeddings";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4/accounts";
const TIMEOUT_MS = 5000;
const CACHED_QUERIES = 1000;
// Docs rescored per doc wanted: more finds more of the exact top docs, slower.
const RESCORED_PER_DOC = 20;
const MIN_RESCORED = 4000;
// Vectors are kept in blocks of 2^BLOCK_SHIFT docs, so adding docs never
// copies the ones already loaded.
const BLOCK_SHIFT = 13;
const BLOCK = 1 << BLOCK_SHIFT;
const IN_BLOCK = BLOCK - 1;
// ONNX versions of the indexed models; fp32 matches OpenRouter's vectors.
const LOCAL_MODELS: Record<string, string> = { "baai/bge-m3": "Xenova/bge-m3" };
// Workers AI versions of the indexed models; bge-m3's match OpenRouter's vectors.
const CLOUDFLARE_MODELS: Record<string, string> = { "baai/bge-m3": "@cf/baai/bge-m3" };

export type Embedder = (query: string) => Promise<Float32Array>;

export interface Semantic {
  index: Index;
  embed: Embedder;
}

// Recent query vectors, so paging keeps the same ranking.
const queryCache = new Map<string, Float32Array>();

// Docs are numbered in the order they were loaded. Deleted ones stay, marked
// in `deleted`, and drop out of `live` and `chapterDocs`.
export interface Index {
  model: string;
  dims: number;
  count: number;
  bits: Uint32Array[]; // blocks, dims / 32 words per doc; bit j set if dimension j > 0
  int8: Int8Array[]; // blocks, dims per doc; the vector is about row * scale
  scales: Float32Array;
  sections: Int32Array; // the section each doc opens
  ids: Uint32Array; // the doc's row in `vectors`, increasing
  deleted: Uint8Array;
  channels: string[];
  episodes: string[];
  dates: string[];
  kinds: string[];
  live: Uint32Array;
  chapterDocs: Uint32Array;
  episodeDoc: Map<string, number>; // episode id to its own doc
  lastDeleted: number; // the last row of `deleted_vectors` applied
}

export interface DocFilter {
  channels?: Set<string>;
  startDate?: string;
  endDate?: string;
}

interface VectorRow {
  id: number;
  kind: string;
  episode_id: string;
  channel_id: string;
  section_id: number;
  bits: Uint8Array;
  int8: Uint8Array;
  scale: number;
  date: string | null;
}

// Repeated ids and dates share one string each.
const strings = new Map<string, string>();
const intern = (s: string) => strings.get(s) ?? (strings.set(s, s), s);

function grown<T extends Float32Array | Int32Array | Uint32Array | Uint8Array>(a: T, n: number): T {
  if (n <= a.length) return a;
  const bigger = new (a.constructor as new (n: number) => T)(Math.max(n, a.length * 2, 1024));
  bigger.set(a);
  return bigger;
}

function hasTable(name: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name) !== undefined;
}

export function loadIndex(model: string): Index | undefined {
  const info = db.prepare("SELECT value FROM build_info WHERE key = 'model'").get();
  if (!hasTable("vectors") || !info || JSON.parse(info.value as string) !== model) return undefined;
  const { dims } = db.prepare("SELECT max(length(int8)) AS dims FROM vectors").get() as { dims: number };
  if (!dims || dims % 32) throw new Error(`vectors: ${dims} dimensions, not a multiple of 32`);
  const index: Index = {
    model,
    dims,
    count: 0,
    bits: [],
    int8: [],
    scales: new Float32Array(),
    sections: new Int32Array(),
    ids: new Uint32Array(),
    deleted: new Uint8Array(),
    channels: [],
    episodes: [],
    dates: [],
    kinds: [],
    live: new Uint32Array(),
    chapterDocs: new Uint32Array(),
    episodeDoc: new Map(),
    lastDeleted: 0,
  };
  // Deletions before now are already gone from `vectors`.
  if (hasTable("deleted_vectors")) {
    index.lastDeleted = Number(db.prepare("SELECT coalesce(max(id), 0) AS n FROM deleted_vectors").get()!.n);
  }
  refreshIndex(index);
  return index;
}

// Adds the docs written since the last call and drops the deleted ones.
// Returns whether anything changed.
export function refreshIndex(index: Index): boolean {
  db.exec("BEGIN"); // one snapshot for both
  try {
    const lastId = index.count ? index.ids[index.count - 1] : 0;
    const rows = db
      .prepare(
        `SELECT v.id, v.kind, v.episode_id, v.channel_id, v.section_id, v.bits, v.int8, v.scale, e.date
         FROM vectors v LEFT JOIN episodes e ON e.id = v.episode_id WHERE v.id > ? ORDER BY v.id`,
      )
      .iterate(lastId) as Iterable<VectorRow>;
    const before = index.count;
    for (const r of rows) append(index, r);
    let deleted = 0;
    if (hasTable("deleted_vectors")) {
      const gone = db
        .prepare("SELECT id, vector_id FROM deleted_vectors WHERE id > ? ORDER BY id")
        .all(index.lastDeleted) as { id: number; vector_id: number }[];
      for (const { id, vector_id } of gone) {
        deleted += remove(index, vector_id);
        index.lastDeleted = id;
      }
    }
    if (index.count === before && !deleted) return false;
    index.live = Uint32Array.from({ length: index.count }, (_, i) => i).filter((i) => !index.deleted[i]);
    index.chapterDocs = index.live.filter((i) => index.kinds[i] === "chapter");
    return true;
  } finally {
    db.exec("COMMIT");
  }
}

function append(index: Index, r: VectorRow) {
  const { dims } = index;
  const i = index.count;
  const block = i >>> BLOCK_SHIFT;
  if (block === index.int8.length) {
    index.bits.push(new Uint32Array((BLOCK * dims) / 32));
    index.int8.push(new Int8Array(BLOCK * dims));
  }
  const at = i & IN_BLOCK;
  new Uint8Array(index.bits[block].buffer).set(r.bits, (at * dims) / 8);
  new Uint8Array(index.int8[block].buffer).set(r.int8, at * dims);
  index.scales = grown(index.scales, i + 1);
  index.sections = grown(index.sections, i + 1);
  index.ids = grown(index.ids, i + 1);
  index.deleted = grown(index.deleted, i + 1);
  index.scales[i] = r.scale;
  index.sections[i] = r.section_id;
  index.ids[i] = r.id;
  index.channels.push(intern(r.channel_id));
  index.episodes.push(intern(r.episode_id));
  index.dates.push(intern(r.date ?? ""));
  index.kinds.push(intern(r.kind));
  if (r.kind !== "chapter") index.episodeDoc.set(r.episode_id, i);
  index.count++;
}

// Marks the doc of a `vectors` row deleted; 1 if it was loaded, else 0.
function remove(index: Index, id: number): number {
  let lo = 0;
  let hi = index.count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index.ids[mid] < id) lo = mid + 1;
    else hi = mid;
  }
  if (lo === index.count || index.ids[lo] !== id || index.deleted[lo]) return 0;
  index.deleted[lo] = 1;
  const episode = index.episodes[lo];
  if (index.episodeDoc.get(episode) === lo) index.episodeDoc.delete(episode);
  return 1;
}

export async function localEmbedder(model: string, cacheDir: string): Promise<Embedder> {
  const onnx = LOCAL_MODELS[model];
  if (!onnx) throw new Error(`no local version of ${model}`);
  // Imported here, so servers using an API don't load onnxruntime.
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  const extract = await pipeline("feature-extraction", onnx, { dtype: "fp32" });
  return async (query) => {
    const out = await extract(query, { pooling: "cls", normalize: true });
    return out.data as Float32Array;
  };
}

export function openRouterEmbedder(model: string, key: string): Embedder {
  return async (query) => {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: [query] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const vector = Float32Array.from(body.data?.[0]?.embedding ?? []);
    if (!vector.length) throw new Error(`no embedding in reply: ${JSON.stringify(body).slice(0, 200)}`);
    const norm = Math.hypot(...vector);
    return vector.map((x) => x / norm);
  };
}

export function cloudflareEmbedder(model: string, account: string, token: string): Embedder {
  const cf = CLOUDFLARE_MODELS[model];
  if (!cf) throw new Error(`no Workers AI version of ${model}`);
  return async (query) => {
    const res = await fetch(`${CLOUDFLARE_API}/${account}/ai/run/${cf}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: [query] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Workers AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const vector = Float32Array.from(body.result?.data?.[0] ?? []);
    if (!vector.length) throw new Error(`no embedding in reply: ${JSON.stringify(body).slice(0, 200)}`);
    const norm = Math.hypot(...vector);
    return vector.map((x) => x / norm);
  };
}

async function embedQuery(embed: Embedder, query: string): Promise<Float32Array> {
  const cached = queryCache.get(query);
  if (cached) return cached;
  const vector = await embed(query);
  queryCache.set(query, vector);
  if (queryCache.size > CACHED_QUERIES) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}

// A doc's own vector, to search with.
export function docVector(index: Index, doc: number): Float32Array {
  const { dims, scales } = index;
  const row = (doc & IN_BLOCK) * dims;
  return Float32Array.from(index.int8[doc >>> BLOCK_SHIFT].subarray(row, row + dims), (x) => x * scales[doc]);
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

// The docs nearest q by Hamming distance between sign bits: at least n of
// them, more where distances tie.
function nearestByBits(index: Index, docs: Uint32Array, q: Float32Array, n: number): Uint32Array {
  const { dims } = index;
  const words = dims / 32;
  const qbits = new Uint32Array(words);
  for (let j = 0; j < dims; j++) if (q[j] > 0) qbits[j >>> 5] |= 1 << (j & 31);
  if (n >= docs.length) return docs.slice(); // ranked() sorts it, and docs can be the index's own

  const distances = new Uint16Array(docs.length);
  const counts = new Uint32Array(dims + 1);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const bits = index.bits[doc >>> BLOCK_SHIFT];
    let d = 0;
    for (let row = (doc & IN_BLOCK) * words, w = 0; w < words; w++) d += popcount(bits[row + w] ^ qbits[w]);
    distances[i] = d;
    counts[d]++;
  }
  let threshold = 0;
  for (let total = counts[0]; total < n; total += counts[++threshold]);
  return docs.filter((_, i) => distances[i] <= threshold);
}

// The best m of docs by their int8 vectors' dot product with q, best first,
// out of the ones nearest by bits.
export function ranked(index: Index, docs: Uint32Array, q: Float32Array, m: number): Uint32Array {
  const { dims, scales } = index;
  const candidates = nearestByBits(index, docs, q, Math.max(m * RESCORED_PER_DOC, MIN_RESCORED));
  const scores = new Float32Array(index.count);
  for (const doc of candidates) {
    const int8 = index.int8[doc >>> BLOCK_SHIFT];
    // four sums: about twice as fast as one
    let a = 0, b = 0, c = 0, d = 0;
    for (let row = (doc & IN_BLOCK) * dims, j = 0; j < dims; j += 4) {
      a += int8[row + j] * q[j];
      b += int8[row + j + 1] * q[j + 1];
      c += int8[row + j + 2] * q[j + 2];
      d += int8[row + j + 3] * q[j + 3];
    }
    scores[doc] = (a + b + c + d) * scales[doc];
  }
  return candidates.toSorted((x, y) => scores[y] - scores[x]).subarray(0, m);
}

export async function semanticSearch(
  { index, embed }: Semantic,
  query: string,
  k: number,
  filter: DocFilter = {},
): Promise<number[]> {
  const q = await embedQuery(embed, query);
  const { channels, startDate, endDate } = filter;
  const { sections } = index;
  let docs = index.live;
  if (channels) docs = docs.filter((i) => channels.has(index.channels[i]));
  if (startDate) docs = docs.filter((i) => index.dates[i] >= startDate);
  if (endDate) docs = docs.filter((i) => index.dates[i] <= endDate);

  // Several docs can open the same section, so take the best few times k
  // and widen until they cover k sections.
  for (let m = k * 4; ; m *= 4) {
    const top = ranked(index, docs, q, m);
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const doc of top) {
      const id = sections[doc];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === k) return ids;
    }
    if (top.length === docs.length) return ids;
  }
}

// Search over the embeddings `pipeline.embed` writes, all held in memory.
// Unfiltered searches go through the HNSW index `pipeline.hnsw` saves next to
// map.json; searches limited to some channels compare the query with each of
// their docs, which is exact and, for a few channels, fast.

import fs from "node:fs";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";
import { Index as Hnsw, MetricKind, ScalarKind } from "usearch";
import { db } from "../db/connection.js";

const API = "https://openrouter.ai/api/v1/embeddings";
const TIMEOUT_MS = 5000;
const CACHED_QUERIES = 1000;
const HNSW_CANDIDATES = 1600;
// ONNX versions of the indexed models; fp32 matches OpenRouter's vectors.
const LOCAL_MODELS: Record<string, string> = { "baai/bge-m3": "Xenova/bge-m3" };

export type Embedder = (query: string) => Promise<Float32Array>;

export interface Semantic {
  index: Index;
  embed: Embedder;
}

// Recent query vectors, so paging keeps the same ranking.
const queryCache = new Map<string, Float32Array>();

export interface Index {
  model: string;
  dims: number;
  vectors: Float32Array; // row-major, one unit-length row per doc
  sections: Int32Array; // the section each doc opens
  channels: string[];
  hnsw?: Hnsw; // keyed by the table's ids
  rows: Map<number, number>; // table id to doc
}

// Docs without a section are left out, since a hit on them can't be shown.
export function loadIndex(model: string, embeddingsDir: string): Index | undefined {
  const known = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'embedding_models'").get();
  const row = known && db.prepare("SELECT table_name FROM embedding_models WHERE model = ?").get(model);
  if (!row) return undefined;
  const from = `FROM ${row.table_name} WHERE section_id IS NOT NULL`;
  const count = db.prepare(`SELECT count(*) AS n, max(length(vector)) AS bytes ${from}`).get() as {
    n: number;
    bytes: number;
  };
  const dims = count.bytes / 2; // float16
  if (dims % 4) throw new Error(`${row.table_name}: ${dims} dimensions, not a multiple of 4`);
  const index: Index = {
    model,
    dims,
    vectors: new Float32Array(count.n * dims),
    sections: new Int32Array(count.n),
    channels: [],
    rows: new Map(),
  };
  const rows = db.prepare(`SELECT id, channel_id, section_id, vector ${from} ORDER BY id`).iterate() as Iterable<{
    id: number;
    channel_id: string;
    section_id: number;
    vector: Uint8Array;
  }>;
  let i = 0;
  for (const r of rows) {
    const bytes = r.vector.slice(); // its own buffer, so float16 reads are aligned
    index.vectors.set(new Float16Array(bytes.buffer, 0, dims), i * dims);
    index.sections[i] = r.section_id;
    index.channels.push(r.channel_id);
    index.rows.set(r.id, i);
    i++;
  }
  index.hnsw = loadHnsw(path.join(embeddingsDir, "hnsw.usearch"), row.table_name as string, dims);
  return index;
}

function loadHnsw(file: string, table: string, dims: number): Hnsw | undefined {
  if (!fs.existsSync(file)) {
    console.warn(`no HNSW index at ${file}: semantic search scans every doc`);
    return undefined;
  }
  const hnsw = new Hnsw(dims, MetricKind.IP, ScalarKind.F16);
  hnsw.view(file);
  const ids = db.prepare(`SELECT id FROM ${table}`).all().map((r) => BigInt(r.id as number));
  const held = hnsw.contains(BigUint64Array.from(ids)) as boolean[];
  if (hnsw.size() !== ids.length || !held.every(Boolean)) {
    console.warn(`${file} is out of date with ${table}: semantic search scans every doc (run pipeline.embed)`);
    return undefined;
  }
  return hnsw;
}

export async function localEmbedder(model: string, cacheDir: string): Promise<Embedder> {
  const onnx = LOCAL_MODELS[model];
  if (!onnx) throw new Error(`no local version of ${model}`);
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

async function embedQuery(embed: Embedder, query: string): Promise<Float32Array> {
  const cached = queryCache.get(query);
  if (cached) return cached;
  const vector = await embed(query);
  queryCache.set(query, vector);
  if (queryCache.size > CACHED_QUERIES) queryCache.delete(queryCache.keys().next().value!);
  return vector;
}

function dotProducts(vectors: Float32Array, dims: number, docs: Uint32Array, q: Float32Array): Float32Array {
  const scores = new Float32Array(docs.length);
  for (let n = 0; n < docs.length; n++) {
    // four sums: about twice as fast as one
    let a = 0, b = 0, c = 0, d = 0;
    for (let row = docs[n] * dims, j = 0; j < dims; j += 4) {
      a += vectors[row + j] * q[j];
      b += vectors[row + j + 1] * q[j + 1];
      c += vectors[row + j + 2] * q[j + 2];
      d += vectors[row + j + 3] * q[j + 3];
    }
    scores[n] = a + b + c + d;
  }
  return scores;
}

function best(scores: Float32Array, m: number): Uint32Array {
  const order = Uint32Array.from(scores.keys());
  if (m < scores.length) {
    const threshold = Float32Array.from(scores).sort()[scores.length - m];
    return order.filter((n) => scores[n] >= threshold).sort((a, b) => scores[b] - scores[a]);
  }
  return order.sort((a, b) => scores[b] - scores[a]);
}

export async function semanticSearch(
  index: Index,
  query: string,
  k: number,
  embed: Embedder,
  channels?: Set<string>,
): Promise<number[]> {
  const q = await embedQuery(embed, query);
  if (index.hnsw && !channels) {
    const ids = hnswSearch(index, index.hnsw, q, k);
    if (ids.length === k) return ids;
  }
  const { vectors, dims, sections } = index;
  let docs = Uint32Array.from(sections.keys());
  if (channels) docs = docs.filter((i) => channels.has(index.channels[i]));
  const scores = dotProducts(vectors, dims, docs, q);

  // Several docs can open the same section, so take the best few times k
  // and widen until they cover k sections.
  for (let m = k * 4; ; m *= 4) {
    const top = best(scores, m);
    const ids: number[] = [];
    const seen = new Set<number>();
    for (const n of top) {
      const id = sections[docs[n]];
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === k) return ids;
    }
    if (top.length === docs.length) return ids;
  }
}

// Fewer than k sections if the candidates don't cover that many.
function hnswSearch(index: Index, hnsw: Hnsw, q: Float32Array, k: number): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const key of hnsw.search(q, HNSW_CANDIDATES, 1).keys) {
    const doc = index.rows.get(Number(key));
    if (doc === undefined) continue; // no section
    const id = index.sections[doc];
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length === k) break;
  }
  return ids;
}

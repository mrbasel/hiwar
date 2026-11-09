// Semantic search over the episode and chapter embeddings written by
// `search.embed` (Python), mirroring search/semantic.py: brute force over
// every vector, each hit mapped to a section of the current database.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const API = "https://openrouter.ai/api/v1/embeddings";
const TIMEOUT_MS = 5000;

interface Doc {
  kind: "episode" | "chapter";
  episode_id: string;
  start: number;
  end: number;
}

export interface Index {
  model: string;
  dims: number;
  vectors: Float32Array; // row-major, one unit-length row per doc
  docs: Doc[];
}

// vectors.npy is a little-endian float16 matrix: a short header, then the raw data.
function readNpy(file: string): { shape: number[]; data: Float32Array } {
  const buf = fs.readFileSync(file);
  const headerLen = buf.readUInt16LE(8);
  const header = buf.toString("latin1", 10, 10 + headerLen);
  if (!header.includes("'<f2'")) throw new Error(`${file}: expected float16 data`);
  const shape = header.match(/\((\d+), (\d+)\)/)!.slice(1).map(Number);
  const offset = 10 + headerLen;
  const halves = new Float16Array(buf.buffer, buf.byteOffset + offset, shape[0] * shape[1]);
  return { shape, data: Float32Array.from(halves) };
}

export function loadIndex(dir: string): Index {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const { shape, data } = readNpy(path.join(dir, "vectors.npy"));
  const docs = fs
    .readFileSync(path.join(dir, "docs.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const d = JSON.parse(line);
      return { kind: d.kind, episode_id: d.episode_id, start: d.start, end: d.end };
    });
  if (docs.length !== shape[0]) throw new Error(`${dir}: ${docs.length} docs but ${shape[0]} vectors`);
  return { model: meta.model, dims: shape[1], vectors: data, docs };
}

async function embedQuery(model: string, query: string, key: string): Promise<Float32Array> {
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
}

// Section ids, best first: a chapter hit becomes the section overlapping it
// most, an episode hit the episode's first section.
export async function semanticSearch(
  db: DatabaseSync,
  index: Index,
  query: string,
  k: number,
  key: string,
): Promise<number[]> {
  const q = await embedQuery(index.model, query, key);
  const { vectors, dims, docs } = index;
  const scores = new Float32Array(docs.length);
  for (let i = 0; i < docs.length; i++) {
    let s = 0;
    const row = i * dims;
    for (let j = 0; j < dims; j++) s += vectors[row + j] * q[j];
    scores[i] = s;
  }
  const order = Uint32Array.from(docs.keys()).sort((a, b) => scores[b] - scores[a]);

  const chapterSection = db.prepare(
    `SELECT id FROM sections
     WHERE episode_id = ? AND start_time < ? AND end_time > ?
     ORDER BY min(end_time, ?) - max(start_time, ?) DESC LIMIT 1`,
  );
  const firstSection = db.prepare("SELECT id FROM sections WHERE episode_id = ? ORDER BY idx LIMIT 1");

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const i of order) {
    const d = docs[i];
    const row =
      d.kind === "chapter"
        ? chapterSection.get(d.episode_id, d.end, d.start, d.end, d.start)
        : firstSection.get(d.episode_id);
    if (!row || seen.has(Number(row.id))) continue; // episode gone from the database
    seen.add(Number(row.id));
    ids.push(Number(row.id));
    if (ids.length === k) break;
  }
  return ids;
}

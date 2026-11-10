import express from "express";
import fs from "node:fs";
import path from "node:path";
import { openDb, QueryError, search, type SearchParams, type Semantic } from "./search.js";
import { loadIndex } from "./semantic.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, "podcasts.db");
const EMBEDDINGS_DIR = process.env.EMBEDDINGS_DIR ?? path.join(ROOT, "embeddings/bge-m3");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const db = openDb(DB_PATH);

// Hybrid search needs the embeddings and an OpenRouter key; without either,
// search is BM25 only.
let semantic: Semantic | undefined;
if (!process.env.OPENROUTER_KEY) {
  console.warn("OPENROUTER_KEY not set: BM25 search only");
} else if (!fs.existsSync(path.join(EMBEDDINGS_DIR, "vectors.npy"))) {
  console.warn(`no embeddings in ${EMBEDDINGS_DIR}: BM25 search only`);
} else {
  const started = performance.now();
  semantic = { index: loadIndex(EMBEDDINGS_DIR), key: process.env.OPENROUTER_KEY };
  console.log(
    `loaded ${semantic.index.docs.length} embeddings (${semantic.index.model}) ` +
      `in ${Math.round(performance.now() - started)} ms`,
  );
}
const app = express();

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

app.get("/api/search", async (req, res) => {
  const params: SearchParams = {
    q: str(req.query.q) ?? "",
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
    mode: req.query.mode === "keyword" ? "keyword" : "hybrid",
  };
  try {
    res.json(await search(db, params, semantic));
  } catch (err) {
    if (err instanceof QueryError) res.status(400).json({ error: err.message });
    else throw err;
  }
});

// The episode map for /map.html, written by `search.map` (Python).
app.get("/api/map", (_req, res) => {
  const file = path.join(EMBEDDINGS_DIR, "map.json");
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).json({ error: "no map yet: run `uv run python -m search.map`" });
});

app.use(express.static(path.resolve(import.meta.dirname, "../public")));

app.listen(PORT, HOST, () => {
  console.log(`Search at http://${HOST}:${PORT} (db: ${DB_PATH})`);
});

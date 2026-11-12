import express from "express";
import fs from "node:fs";
import path from "node:path";
import { openDb, QueryError, search, type SearchParams, type Semantic } from "./search.js";
import { loadIndex, localEmbedder, openRouterEmbedder, type Index } from "./semantic.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const DB_PATH = process.env.DB_PATH ?? path.join(ROOT, "podcasts.db");
// Its embeddings are in the database, written by `search.embed`.
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "baai/bge-m3";
// For map.json.
const EMBEDDINGS_DIR = process.env.EMBEDDINGS_DIR ?? path.join(ROOT, "embeddings/bge-m3");
// Local model, downloaded on first start (~2.3 GB).
const MODELS_DIR = process.env.MODELS_DIR ?? path.join(ROOT, "models");
// "local" or "openrouter".
const QUERY_EMBEDDER = process.env.QUERY_EMBEDDER ?? "local";
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const db = openDb(DB_PATH);

let semantic: Semantic | undefined;
let index: Index | undefined;
if (QUERY_EMBEDDER === "openrouter" && !process.env.OPENROUTER_KEY) {
  console.warn("OPENROUTER_KEY not set: BM25 search only");
} else {
  const started = performance.now();
  index = loadIndex(db, EMBEDDING_MODEL);
  if (index) {
    console.log(
      `loaded ${index.sections.length} embeddings (${index.model}) in ${Math.round(performance.now() - started)} ms`,
    );
  } else {
    console.warn(`no ${EMBEDDING_MODEL} embeddings in ${DB_PATH}: BM25 search only`);
  }
}
if (index) {
  if (QUERY_EMBEDDER === "openrouter") {
    semantic = { index, embed: openRouterEmbedder(index.model, process.env.OPENROUTER_KEY!) };
  } else {
    const started = performance.now();
    console.log(`loading ${index.model} for queries from ${MODELS_DIR} (downloaded on first start)`);
    try {
      semantic = { index, embed: await localEmbedder(index.model, MODELS_DIR) };
      console.log(`loaded the query model in ${Math.round(performance.now() - started)} ms`);
    } catch (err) {
      console.warn(`could not load the query model: ${(err as Error).message}: BM25 search only`);
    }
  }
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
    // ?shows=id1,id2: channel ids
    shows: str(req.query.shows)?.split(",").map((s) => s.trim()).filter(Boolean),
  };
  try {
    res.json(await search(db, params, semantic));
  } catch (err) {
    if (err instanceof QueryError) res.status(400).json({ error: err.message });
    else throw err;
  }
});

// Channels to filter by, biggest first.
const listShows = db.prepare(
  `SELECT c.id, trim(c.name) AS name, count(*) AS episodes
   FROM episodes e JOIN channels c ON c.id = e.channel_id
   GROUP BY c.id ORDER BY episodes DESC, name`,
);
app.get("/api/shows", (_req, res) => {
  res.json(listShows.all());
});

app.get("/api/map", (_req, res) => {
  const file = path.join(EMBEDDINGS_DIR, "map.json");
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).json({ error: "no map yet: run `uv run python -m search.map`" });
});

app.use(express.static(path.resolve(import.meta.dirname, "../public")));

app.listen(PORT, HOST, (err?: Error) => {
  if (err) throw err;
  console.log(`Search at http://${HOST}:${PORT} (db: ${DB_PATH})`);
});

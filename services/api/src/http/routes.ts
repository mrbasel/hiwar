import express from "express";
import { rateLimit } from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { semantic } from "../bootstrap.js";
import { config } from "../config.js";
import { episodeById, listShows, publishedAt } from "../db/queries.js";
import { presentEpisode } from "../episodes/present.js";
import { recommendations } from "../episodes/recommend.js";
import { QueryError, search, type SearchParams } from "../search/service.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function limit(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "طلبات كثيرة، حاول بعد دقيقة." },
  });
}

export const api = express.Router();

api.get("/search", limit(30), async (req, res) => {
  const params: SearchParams = {
    q: str(req.query.q) ?? "",
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
    mode: req.query.mode === "keyword" ? "keyword" : "hybrid",
    shows: str(req.query.shows)?.split(",").map((s) => s.trim()).filter(Boolean),
    startDate: str(req.query.startDate),
    endDate: str(req.query.endDate),
  };
  try {
    res.json(await search(params));
  } catch (err) {
    if (err instanceof QueryError) res.status(400).json({ error: err.message });
    else throw err;
  }
});

// For deploys and checks: how current the data is, and whether semantic search loaded.
api.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    published_at: publishedAt(),
    vectors: semantic?.index.live.length ?? 0,
    semantic: semantic !== undefined,
  });
});

api.get("/shows", (_req, res) => {
  res.json(listShows());
});

api.get("/episodes/:id", (req, res) => {
  const episode = presentEpisode(req.params.id);
  if (episode) res.json(episode);
  else res.status(404).json({ error: "لا توجد حلقة بهذا المعرّف." });
});

api.get("/episodes/:id/recommendations", limit(60), (req: express.Request<{ id: string }>, res) => {
  if (!episodeById(req.params.id)) {
    res.status(404).json({ error: "لا توجد حلقة بهذا المعرّف." });
    return;
  }
  res.json(recommendations(req.params.id));
});

api.get("/map", (_req, res, next) => {
  if (!config.dev) return next();
  const file = path.join(config.embeddingsDir, "map.json");
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).json({ error: "no map yet: run `uv run python -m pipeline.map`" });
});

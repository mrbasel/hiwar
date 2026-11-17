import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { episodeById, listShows } from "../db/queries.js";
import { presentEpisode } from "../episodes/present.js";
import { recommendations } from "../episodes/recommend.js";
import { QueryError, search, type SearchParams } from "../search/service.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export const api = express.Router();

api.get("/search", async (req, res) => {
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

api.get("/shows", (_req, res) => {
  res.json(listShows());
});

api.get("/episodes/:id", (req, res) => {
  const episode = presentEpisode(req.params.id);
  if (episode) res.json(episode);
  else res.status(404).json({ error: "لا توجد حلقة بهذا المعرّف." });
});

api.get("/episodes/:id/recommendations", (req, res) => {
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

import express from "express";
import path from "node:path";
import { openDb, QueryError, search, type SearchParams } from "./search.js";

const DB_PATH = process.env.DB_PATH ?? path.resolve(import.meta.dirname, "../../podcasts.db");
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const db = openDb(DB_PATH);
const app = express();

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

app.get("/api/search", (req, res) => {
  const params: SearchParams = {
    q: str(req.query.q) ?? "",
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
  };
  try {
    res.json(search(db, params));
  } catch (err) {
    if (err instanceof QueryError) res.status(400).json({ error: err.message });
    else throw err;
  }
});

app.use(express.static(path.resolve(import.meta.dirname, "../public")));

app.listen(PORT, HOST, () => {
  console.log(`Search at http://${HOST}:${PORT} (db: ${DB_PATH})`);
});

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export const config = {
  dbPath: process.env.DB_PATH ?? path.join(ROOT, "podcasts.db"),
  embeddingModel: process.env.EMBEDDING_MODEL ?? "baai/bge-m3",
  // For map.json.
  embeddingsDir: process.env.EMBEDDINGS_DIR ?? path.join(ROOT, "embeddings/bge-m3"),
  // Local model, downloaded on first start (~2.3 GB).
  modelsDir: process.env.MODELS_DIR ?? path.join(ROOT, "models"),
  // "local" or "openrouter".
  queryEmbedder: process.env.QUERY_EMBEDDER ?? "local",
  openRouterKey: process.env.OPENROUTER_KEY,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  publicDir: path.resolve(import.meta.dirname, "../public"),
};

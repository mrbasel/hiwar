import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ENV_FILE = path.join(ROOT, ".env");
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export const config = {
  dev: process.env.NODE_ENV === "development",
  dbPath: process.env.DB_PATH ?? path.join(ROOT, "podcasts.db"),
  embeddingModel: process.env.EMBEDDING_MODEL ?? "baai/bge-m3",
  // For map.json and the HNSW index (hnsw.usearch).
  embeddingsDir: process.env.EMBEDDINGS_DIR ?? path.join(ROOT, "embeddings/bge-m3"),
  // Local model, downloaded on first start (~2.3 GB).
  modelsDir: process.env.MODELS_DIR ?? path.join(ROOT, "models"),
  // "local" or "openrouter".
  queryEmbedder: process.env.QUERY_EMBEDDER ?? "local",
  openRouterKey: process.env.OPENROUTER_KEY,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  // The frontend's build (../frontend, `pnpm build`), served alongside the API.
  publicDir: process.env.PUBLIC_DIR ?? path.join(ROOT, "services/frontend/dist/client"),
};

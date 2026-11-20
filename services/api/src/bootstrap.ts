import { config } from "./config.js";
import {
  cloudflareEmbedder,
  loadIndex,
  localEmbedder,
  openRouterEmbedder,
  type Semantic,
} from "./search/semantic.js";

async function loadSemantic(): Promise<Semantic | undefined> {
  if (config.queryEmbedder === "openrouter" && !config.openRouterKey) {
    console.warn("OPENROUTER_KEY not set: BM25 search only");
    return undefined;
  }
  if (config.queryEmbedder === "cloudflare" && !(config.cloudflareAccount && config.cloudflareToken)) {
    console.warn("CF_ACCOUNT_ID or CF_API_TOKEN not set: BM25 search only");
    return undefined;
  }

  let started = performance.now();
  const index = loadIndex(config.embeddingModel);
  if (!index) {
    console.warn(`no ${config.embeddingModel} vectors in ${config.dbPath}: BM25 search only`);
    return undefined;
  }
  console.log(
    `loaded ${index.live.length} vectors (${index.model}) in ${Math.round(performance.now() - started)} ms`,
  );

  if (config.queryEmbedder === "openrouter") {
    return { index, embed: openRouterEmbedder(index.model, config.openRouterKey!) };
  }
  if (config.queryEmbedder === "cloudflare") {
    return { index, embed: cloudflareEmbedder(index.model, config.cloudflareAccount!, config.cloudflareToken!) };
  }
  started = performance.now();
  console.log(`loading ${index.model} for queries from ${config.modelsDir} (downloaded on first start)`);
  try {
    const embed = await localEmbedder(index.model, config.modelsDir);
    console.log(`loaded the query model in ${Math.round(performance.now() - started)} ms`);
    return { index, embed };
  } catch (err) {
    console.warn(`could not load the query model: ${(err as Error).message}: BM25 search only`);
    return undefined;
  }
}

export const semantic = await loadSemantic();

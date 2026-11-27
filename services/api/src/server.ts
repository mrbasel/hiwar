import compression from "compression";
import express from "express";
import path from "node:path";
import { semantic } from "./bootstrap.js";
import { config } from "./config.js";
import { watch } from "./db/watch.js";
import { clearRecommendations } from "./episodes/recommend.js";
import { requestLog } from "./http/log.js";
import { api } from "./http/routes.js";
import { refreshIndex } from "./search/semantic.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);
app.use(requestLog);
app.use(compression());
app.use("/api", api);
app.use(express.static(config.publicDir));
// The frontend is a single-page app: any other page gets its shell, and its
// router takes over in the browser.
app.get("/{*page}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(config.publicDir, "_shell.html"), (err) => {
    if (err) res.status(404).send("frontend not built: run `pnpm build` in services/frontend/");
  });
});

// Episodes the server's pipeline adds or deletes go live without a restart:
// queries read the database as it is, and the vectors in memory catch up.
watch(() => {
  if (!semantic || !refreshIndex(semantic.index)) return;
  clearRecommendations();
  console.log(`vectors now ${semantic.index.live.length}`);
});

app.listen(config.port, config.host, (err?: Error) => {
  if (err) throw err;
  console.log(`Search at http://${config.host}:${config.port} (db: ${config.dbPath})`);
});

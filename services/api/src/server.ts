import compression from "compression";
import express from "express";
import path from "node:path";
import { config } from "./config.js";
import { api } from "./http/routes.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);
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

app.listen(config.port, config.host, (err?: Error) => {
  if (err) throw err;
  console.log(`Search at http://${config.host}:${config.port} (db: ${config.dbPath})`);
});

import express from "express";
import { config } from "./config.js";
import { api } from "./http/routes.js";

const app = express();
app.use("/api", api);
app.use(express.static(config.publicDir));

app.listen(config.port, config.host, (err?: Error) => {
  if (err) throw err;
  console.log(`Search at http://${config.host}:${config.port} (db: ${config.dbPath})`);
});

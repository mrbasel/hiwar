import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

// Read-only: the server's pipeline writes, and the API follows (see watch.ts).
export const db = new DatabaseSync(config.dbPath, { readOnly: true });

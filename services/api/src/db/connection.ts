import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

export const db = new DatabaseSync(config.dbPath, { readOnly: true });

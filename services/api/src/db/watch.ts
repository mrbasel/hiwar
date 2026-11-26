import { db } from "./connection.js";

// How often to check whether the database changed.
const POLL_MS = 5000;

// Calls onChange whenever another connection (the server's pipeline) has
// committed since the last check, and again on the next one if it threw.
const version = () => Number(db.prepare("PRAGMA data_version").get()!.data_version);

export function watch(onChange: () => void) {
  let last = version();
  setInterval(() => {
    const now = version();
    if (now === last) return;
    try {
      onChange();
      last = now;
    } catch (err) {
      console.error(`couldn't catch up with the database: ${(err as Error).message}`);
    }
  }, POLL_MS).unref();
}

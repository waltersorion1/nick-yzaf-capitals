// Test-only HTTP wrapper: worker updates are simulated without editing production files.
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { readFileSync } from "node:fs";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/db.js";
if (process.env.NODE_ENV !== "test")
  throw new Error("E2E server requires test mode");
const db = createDatabase(process.env.DATABASE_URL!),
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const Store = connectPgSimple(session),
  store = new Store({
    pool,
    tableName: "sessions",
    pruneSessionInterval: false,
  });
let revision = 1;
const wrapper = express();
wrapper.post("/__e2e/worker-version", (_req, res) => {
  revision++;
  res.sendStatus(204);
});
wrapper.get("/sw.js", (_req, res) => {
  res
    .type("application/javascript")
    .set("Cache-Control", "no-store")
    .send(
      readFileSync("public/sw.js", "utf8").replace(
        "nycap-public-v2",
        "nycap-public-e2e-" + revision,
      ),
    );
});
wrapper.use(
  createApp({
    db,
    store,
    secret: process.env.SESSION_SECRET!,
    origin: process.env.APP_ORIGIN!,
  }),
);
const server = wrapper.listen(Number(process.env.PORT), "127.0.0.1");
function shutdown() {
  server.close(() => {
    store.close();
    void Promise.all([db.$disconnect(), pool.end()]);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

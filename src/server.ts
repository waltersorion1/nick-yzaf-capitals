import "dotenv/config";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createDatabase } from "./db.js";
import pg from "pg";
import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import { log } from "./logging.js";
const env = readConfig();
const db = createDatabase(env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
pool.on("error", () => log({ event: "database_error", level: "error" }));
const PgStore = connectPgSimple(session);
await db.$connect();
const store = new PgStore({
  pool,
  tableName: "sessions",
  createTableIfMissing: false,
  errorLog: () => log({ event: "session_error", level: "error" }),
});
const server = createApp({
  db,
  store,
  secret: env.SESSION_SECRET,
  origin: env.APP_ORIGIN,
  production: env.NODE_ENV === "production",
}).listen(env.PORT, () =>
  log({ event: "listening", level: "info", port: env.PORT }),
);
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    store.close();
    void Promise.all([db.$disconnect(), pool.end()]).catch(() => {
      log({ event: "shutdown_failed", level: "error" });
      process.exitCode = 1;
    });
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);

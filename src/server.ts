import "dotenv/config";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createDatabase } from "./db.js";
import pg from "pg";
import { z } from "zod";
import { createApp } from "./app.js";
const env = z
  .object({
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    APP_ORIGIN: z.string().url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  })
  .parse(process.env);
if (env.NODE_ENV === "production" && !env.APP_ORIGIN.startsWith("https://"))
  throw new Error("Production requires HTTPS");
const db = createDatabase(env.DATABASE_URL);
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const PgStore = connectPgSimple(session);
await db.$connect();
const store = new PgStore({
  pool,
  tableName: "sessions",
  createTableIfMissing: false,
});
const server = createApp({
  db,
  store,
  secret: env.SESSION_SECRET,
  origin: env.APP_ORIGIN,
  production: env.NODE_ENV === "production",
}).listen(env.PORT, () => console.log(`NyCap listening on ${env.PORT}`));
let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    store.close();
    void Promise.all([db.$disconnect(), pool.end()]).catch(() => {
      console.error("Shutdown cleanup failed");
      process.exitCode = 1;
    });
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);

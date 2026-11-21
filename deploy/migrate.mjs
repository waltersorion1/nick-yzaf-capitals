import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!process.env.DATABASE_URL_FILE || process.env.DATABASE_URL)
  throw new Error(
    "Migration owner connection must come from DATABASE_URL_FILE",
  );
process.env.DATABASE_URL = readFileSync(
  process.env.DATABASE_URL_FILE,
  "utf8",
).trim();
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env: process.env, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;

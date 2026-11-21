import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".local", { recursive: true, mode: 0o700 });
const container = "nycap-verify-" + randomUUID();
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
};
const steps = [];
function run(command, args, capture = false) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, {
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (capture) {
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
    }
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0
        ? ok(output.trim())
        : fail(
            new Error(
              `${command} failed (${code})${capture ? ": " + output : ""}`,
            ),
          ),
    );
  });
}
// npm's JS entry works without a shell on Windows as well as Linux.
const npm = (...args) =>
  run(process.execPath, [process.env.npm_execpath, ...args]);
let created = false;
try {
  await run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD",
      "-e",
      "POSTGRES_USER=nycap",
      "-e",
      "POSTGRES_DB=nycap",
      "-p",
      "127.0.0.1::5432",
      "--health-cmd",
      "pg_isready -U nycap -d nycap",
      "--health-interval",
      "1s",
      "--health-retries",
      "30",
      "postgres:17.7",
    ],
    true,
  );
  created = true;
  for (let attempt = 0; ; attempt++) {
    const health = await run(
      "docker",
      ["inspect", "--format={{.State.Health.Status}}", container],
      true,
    );
    if (health === "healthy") break;
    if (attempt >= 40 || health === "unhealthy")
      throw new Error("Disposable PostgreSQL did not become healthy");
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const binding = await run("docker", ["port", container, "5432"], true);
  const port = binding.split(":").at(-1);
  env.DATABASE_URL = `postgresql://nycap:${env.POSTGRES_PASSWORD}@localhost:${port}/nycap`;
  env.TEST_DATABASE_URL = env.DATABASE_URL + "_test";
  env.RECOVERY_CONTAINER = container;
  await run("docker", [
    "exec",
    container,
    "createdb",
    "-U",
    "nycap",
    "nycap_test",
  ]);
  for (const db of [env.DATABASE_URL, env.TEST_DATABASE_URL]) {
    const original = env.DATABASE_URL;
    env.DATABASE_URL = db;
    await npm("run", "db:migrate");
    env.DATABASE_URL = original;
  }
  steps.push("four migrations applied to two empty databases");
  for (const command of [
    "db:generate",
    "build",
    "test",
    "test:e2e",
    "recovery:drill",
  ]) {
    console.log("Verification step: " + command);
    const start = Date.now();
    await npm("run", command);
    steps.push({
      command: "npm run " + command,
      status: "passed",
      elapsedMs: Date.now() - start,
    });
  }
  await npm("audit");
  steps.push("npm audit passed");
  await writeFile(
    ".local/verification-latest.json",
    JSON.stringify({ completedAt: new Date().toISOString(), steps }, null, 2),
  );
  console.log(
    "Isolated verification PASSED; normal databases were not accessed.",
  );
} finally {
  if (created) await run("docker", ["rm", "-f", "-v", container], true);
}

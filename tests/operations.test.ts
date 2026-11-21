import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import session from "express-session";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
const env = {
  DATABASE_URL: "postgresql://fixture:unused@localhost/fixture",
  SESSION_SECRET: "fictional-config-secret-with-32-characters",
  APP_ORIGIN: "https://capital.nickyzaf.xyz",
  NODE_ENV: "production",
};
describe("production configuration and operational boundaries", () => {
  it("requires exact HTTPS origins and nonempty strong secret settings", () => {
    expect(readConfig(env).NODE_ENV).toBe("production");
    for (const APP_ORIGIN of [
      "http://capital.nickyzaf.xyz",
      "https://capital.nickyzaf.xyz/",
      "https://user:pass@capital.nickyzaf.xyz",
      "https://capital.nickyzaf.xyz/path",
      "https://capital.nickyzaf.xyz?q=token",
    ])
      expect(() => readConfig({ ...env, APP_ORIGIN })).toThrow();
    expect(() => readConfig({ ...env, SESSION_SECRET: "short" })).toThrow();
    expect(() =>
      readConfig({ ...env, DATABASE_URL: "https://wrong.example" }),
    ).toThrow();
  });
  it("reads file secrets and rejects ambiguous/missing files without printing values", () => {
    const directory = mkdtempSync(join(tmpdir(), "nycap-config-"));
    try {
      const file = join(directory, "secret");
      writeFileSync(file, env.SESSION_SECRET + "\n", { mode: 0o600 });
      expect(
        readConfig({
          ...env,
          SESSION_SECRET: undefined,
          SESSION_SECRET_FILE: file,
        }).SESSION_SECRET,
      ).toBe(env.SESSION_SECRET);
      expect(() => readConfig({ ...env, SESSION_SECRET_FILE: file })).toThrow(
        "Use only SESSION_SECRET",
      );
      expect(() =>
        readConfig({
          ...env,
          SESSION_SECRET: undefined,
          SESSION_SECRET_FILE: join(directory, "missing"),
        }),
      ).toThrow();
    } finally {
      rmSync(join(directory, "secret"));
      rmdirSync(directory);
    }
  });
  it("provides no-store liveness and safe readiness errors without creating sessions", async () => {
    // Only the readiness failure is stubbed; financial/auth suites use real PostgreSQL.
    const db = {
      $queryRaw: async () => {
        throw new Error("PRIVATE database connection");
      },
    } as unknown as PrismaClient;
    const app = createApp({
      db,
      store: new session.MemoryStore(),
      secret: env.SESSION_SECRET,
      origin: env.APP_ORIGIN,
      production: true,
      logSink: () => {},
    });
    const live = await request(app).get("/health/live");
    expect(live.status).toBe(200);
    expect(live.headers["set-cookie"]).toBeUndefined();
    const ready = await request(app).get("/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body).toEqual({ status: "unavailable" });
    expect(ready.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/api/auth/csrf")).status).toBe(400);
    const secure = await request(app)
      .get("/api/auth/csrf")
      .set("X-Forwarded-Proto", "https");
    expect(secure.status).toBe(200);
    expect(secure.headers["set-cookie"][0]).toContain("Secure");
  });
});

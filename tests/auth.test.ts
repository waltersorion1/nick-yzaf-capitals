import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword, tokenHash, verifyPassword } from "../src/password.js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated migrated test database, distinct from DATABASE_URL",
  );
const db = createDatabase(url);
const pool = new pg.Pool({ connectionString: url });
const Store = connectPgSimple(session);
const store = new Store({
  pool,
  tableName: "sessions",
  pruneSessionInterval: false,
});
const app = createApp({
  db,
  store,
  secret: "test-only-secret-with-at-least-32-characters",
  origin: "http://localhost:3000",
});
const admin = request.agent(app),
  holder = request.agent(app),
  guest = request.agent(app);
const suffix = randomBytes(6).toString("hex");
const adminEmail = `admin-${suffix}@example.test`,
  holderEmail = `holder-${suffix}@example.test`;
const password = "Fictional-test-password-123!";
async function post(agent: typeof admin, path: string, body: object) {
  const csrf = await agent.get("/api/auth/csrf");
  return agent.post(path).set("X-CSRF-Token", csrf.body.token).send(body);
}
beforeAll(async () => {
  const passwordHash = await hashPassword(password);
  await db.user.createMany({
    data: [
      { email: adminEmail, role: "ADMIN", passwordHash },
      { email: holderEmail, passwordHash },
    ],
  });
});
afterAll(async () => {
  store.close();
  await pool.end();
  await db.$disconnect();
});
describe("real PostgreSQL authentication and sessions", () => {
  it("does not authenticate a session when its login audit fails", async () => {
    const user = await db.user.create({
      data: {
        email: `audit-failure-${suffix}@example.test`,
        passwordHash: await hashPassword(password),
      },
    });
    const name = `login_fault_${suffix}`;
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorId"='${user.id}'::uuid AND NEW.action='LOGIN' THEN RAISE EXCEPTION 'Fictional audit fault'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      const agent = request.agent(app);
      const login = await post(agent, "/api/auth/login", {
        email: user.email,
        password,
      });
      expect(login.status).toBe(500);
      expect(login.body).toEqual({ error: "Request failed" });
      expect((await agent.get("/api/auth/me")).status).toBe(401);
      expect(
        await db.auditLog.count({
          where: { actorId: user.id, action: "LOGIN" },
        }),
      ).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
  });
  it("rejects expired/inactive invitations and simultaneous acceptance uses the token once", async () => {
    for (const mode of ["expired", "inactive", "concurrent"]) {
      const token = randomBytes(32).toString("hex");
      const user = await db.user.create({
        data: {
          email: `day6-${mode}-${suffix}@example.test`,
          active: mode !== "inactive",
          inviteHash: tokenHash(token),
          inviteExpiresAt: new Date(
            Date.now() + (mode === "expired" ? -60000 : 60000),
          ),
        },
      });
      const first = request.agent(app),
        second = request.agent(app);
      if (mode === "concurrent") {
        const results = await Promise.all([
          post(first, "/api/auth/accept-invite", { token, password }),
          post(second, "/api/auth/accept-invite", { token, password }),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
        expect(
          await db.auditLog.count({
            where: { actorId: user.id, action: "INVITE_ACCEPTED" },
          }),
        ).toBe(1);
      } else {
        expect(
          (await post(first, "/api/auth/accept-invite", { token, password }))
            .status,
        ).toBe(400);
        expect(
          (await db.user.findUniqueOrThrow({ where: { id: user.id } }))
            .passwordHash,
        ).toBeNull();
      }
    }
  });
  it("rechecks roles in an existing session and rejects a replayed logout cookie", async () => {
    const user = await db.user.create({
      data: {
        email: `revoked-${suffix}@example.test`,
        role: "ADMIN",
        passwordHash: await hashPassword(password),
      },
    });
    const agent = request.agent(app);
    const response = await post(agent, "/api/auth/login", {
      email: user.email,
      password,
    });
    const cookie = response.headers["set-cookie"][0].split(";")[0];
    expect((await agent.get("/api/admin/companies")).status).toBe(200);
    await db.user.update({
      where: { id: user.id },
      data: { role: "SHAREHOLDER" },
    });
    expect((await agent.get("/api/admin/companies")).status).toBe(403);
    expect((await post(agent, "/api/auth/logout", {})).status).toBe(204);
    expect(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
    ).toBe(401);
  });
  it("logs request correlation and status without paths, credentials or private payloads", async () => {
    const lines: string[] = [];
    const logged = createApp({
      db,
      store,
      secret: "logging-test-secret-at-least-32-characters",
      origin: "http://localhost:3000",
      logSink: (line) => {
        lines.push(line);
      },
    });
    const response = await request(logged)
      .post("/api/auth/login?token=PRIVATE_QUERY")
      .set("Authorization", "Bearer PRIVATE_HEADER")
      .send({ password: "PRIVATE_PASSWORD", csv: "PRIVATE_CSV" });
    expect(response.status).toBe(403);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "http_request",
      status: 403,
      category: "auth",
      requestId: response.headers["x-request-id"],
    });
    expect(lines.join("")).not.toMatch(
      /PRIVATE|login\?|password|authorization|cookie/i,
    );
    const missing = await request(logged).get(
      "/private-document-does-not-exist?token=PRIVATE_QUERY",
    );
    expect(missing.headers["cache-control"]).toBe("no-store");
    expect(missing.status).toBe(404);
  });
  it("hashes passwords with unique salts", async () => {
    const a = await hashPassword(password),
      b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword("wrong", a)).toBe(false);
  });
  it("blocks unauthenticated routes and public registration", async () => {
    expect((await guest.get("/api/auth/me")).status).toBe(401);
    expect((await post(guest, "/api/admin/users", {})).status).toBe(401);
    expect((await post(guest, "/api/auth/register", {})).status).toBe(404);
  });
  it("blocks missing CSRF and foreign origins", async () => {
    expect((await guest.post("/api/auth/login").send({})).status).toBe(403);
    const csrf = await guest.get("/api/auth/csrf");
    expect(
      (
        await guest
          .post("/api/auth/login")
          .set("Origin", "https://evil.example")
          .set("X-CSRF-Token", csrf.body.token)
          .send({})
      ).status,
    ).toBe(403);
  });
  it("validates login and hides account existence", async () => {
    expect(
      (await post(guest, "/api/auth/login", { email: "bad" })).status,
    ).toBe(400);
    for (const email of [adminEmail, `missing-${suffix}@example.test`])
      expect(
        (await post(guest, "/api/auth/login", { email, password: "wrong" }))
          .status,
      ).toBe(401);
  });
  it("rotates session on login and persists it in PostgreSQL", async () => {
    const pre = await admin.get("/api/auth/csrf");
    const login = await admin
      .post("/api/auth/login")
      .set("X-CSRF-Token", pre.body.token)
      .send({ email: adminEmail, password });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(login.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(login.headers["set-cookie"][0]).not.toBe(
      pre.headers["set-cookie"][0],
    );
    expect((await admin.get("/api/auth/me")).body.email).toBe(adminEmail);
    expect(
      Number((await pool.query("SELECT count(*) FROM sessions")).rows[0].count),
    ).toBeGreaterThan(0);
  });
  it("rejects a CSRF token from before login", async () => {
    expect(
      (await admin.post("/api/admin/users").set("X-CSRF-Token", "old").send({}))
        .status,
    ).toBe(403);
  });
  it("enforces server-side role checks", async () => {
    expect(
      (await post(holder, "/api/auth/login", { email: holderEmail, password }))
        .status,
    ).toBe(200);
    expect(
      (
        await post(holder, "/api/admin/users", {
          email: `denied-${suffix}@example.test`,
        })
      ).status,
    ).toBe(403);
  });
  it("allows admin creation, validates inputs and rejects duplicates", async () => {
    const input = { email: `created-${suffix}@example.test`, password };
    const created = await post(admin, "/api/admin/users", input);
    expect(created.status).toBe(201);
    expect(created.body.passwordHash).toBeUndefined();
    expect((await post(admin, "/api/admin/users", input)).status).toBe(409);
    expect(
      (
        await post(admin, "/api/admin/users", {
          email: `weak-${suffix}@example.test`,
          password: "weak",
        })
      ).status,
    ).toBe(400);
  });
  it("stores only invitation digest and accepts token once", async () => {
    const email = `invite-${suffix}@example.test`;
    const invited = await post(admin, "/api/admin/users", { email });
    expect(invited.status).toBe(201);
    const token = invited.body.invitationToken;
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.inviteHash).toBe(tokenHash(token));
    expect(user.passwordHash).toBeNull();
    expect(
      (await post(guest, "/api/auth/login", { email, password })).status,
    ).toBe(401);
    expect(
      (await post(guest, "/api/auth/accept-invite", { token, password }))
        .status,
    ).toBe(204);
    expect(
      (await post(guest, "/api/auth/accept-invite", { token, password }))
        .status,
    ).toBe(400);
    expect(
      (await post(guest, "/api/auth/login", { email, password })).status,
    ).toBe(200);
  });
  it("rejects expired invitations", async () => {
    const token = randomBytes(32).toString("hex");
    await db.user.create({
      data: {
        email: `expired-${suffix}@example.test`,
        inviteHash: tokenHash(token),
        inviteExpiresAt: new Date(0),
      },
    });
    expect(
      (await post(guest, "/api/auth/accept-invite", { token, password }))
        .status,
    ).toBe(400);
  });
  it("rejects deactivated users even with a session", async () => {
    await db.user.update({
      where: { email: holderEmail },
      data: { active: false },
    });
    expect((await holder.get("/api/auth/me")).status).toBe(401);
    expect(
      (await post(holder, "/api/auth/login", { email: holderEmail, password }))
        .status,
    ).toBe(401);
  });
  it("destroys sessions on logout", async () => {
    expect((await post(admin, "/api/auth/logout", {})).status).toBe(204);
    expect((await admin.get("/api/auth/me")).status).toBe(401);
  });
  it("sends no-store for API and serves PWA assets with correct dimensions", async () => {
    expect((await guest.get("/api/auth/me")).headers["cache-control"]).toBe(
      "no-store",
    );
    const manifest = await guest.get("/manifest.webmanifest");
    expect(manifest.status).toBe(200);
    expect(JSON.parse(manifest.text).display).toBe("standalone");
    for (const size of [192, 512]) {
      expect((await guest.get(`/icons/icon-${size}.png`)).status).toBe(200);
      const png = readFileSync(`public/icons/icon-${size}.png`);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    expect((await guest.get("/offline.html")).status).toBe(200);
    expect((await guest.get("/sw.js")).status).toBe(200);
  });
  it("marks production sessions Secure", async () => {
    const secureStore = new Store({
      pool,
      tableName: "sessions",
      pruneSessionInterval: false,
    });
    const production = createApp({
      db,
      store: secureStore,
      secret: "test-only-secret-with-at-least-32-characters",
      origin: "https://pilot.example",
      production: true,
    });
    const response = await request(production)
      .get("/api/auth/csrf")
      .set("X-Forwarded-Proto", "https");
    expect(response.headers["set-cookie"][0]).toContain("Secure");
    secureStore.close();
  });
  it("expires server-side sessions", async () => {
    const agent = request.agent(app);
    const email = `created-${suffix}@example.test`;
    expect(
      (await post(agent, "/api/auth/login", { email, password })).status,
    ).toBe(200);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await pool.query(
      "UPDATE sessions SET expire = NOW() - interval '1 hour' WHERE sess->>'userId' = $1",
      [user.id],
    );
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });
  it("rate limits repeated authentication attempts", async () => {
    const limitedApp = createApp({
      db,
      store,
      secret: "test-only-secret-with-at-least-32-characters",
      origin: "http://localhost:3000",
    });
    const agent = request.agent(limitedApp);
    const csrf = await agent.get("/api/auth/csrf");
    for (let i = 0; i < 20; i++)
      expect(
        (
          await agent
            .post("/api/auth/login")
            .set("X-CSRF-Token", csrf.body.token)
            .send({})
        ).status,
      ).toBe(400);
    expect(
      (
        await agent
          .post("/api/auth/login")
          .set("X-CSRF-Token", csrf.body.token)
          .send({})
      ).status,
    ).toBe(429);
  });
  it("enforces share constraints and append-only audits in PostgreSQL", async () => {
    const user = await db.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    const audit = await db.auditLog.create({
      data: { actorId: user.id, action: "TEST_APPEND_ONLY" },
    });
    await expect(
      db.auditLog.update({
        where: { id: audit.id },
        data: { action: "MUTATED" },
      }),
    ).rejects.toThrow();
    await expect(
      db.auditLog.delete({ where: { id: audit.id } }),
    ).rejects.toThrow();
    const company = await db.company.create({
      data: { name: `Fictional constraint test ${suffix}` },
    });
    try {
      await expect(
        db.shareClass.create({
          data: { companyId: company.id, name: "Ordinary", issuedShares: -1n },
        }),
      ).rejects.toThrow();
    } finally {
      await db.company.delete({ where: { id: company.id } });
    }
  });
  it("rejects malformed JSON without caching the error response", async () => {
    const response = await guest
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("records authentication and account administration audits", async () => {
    const records = await db.auditLog.findMany({
      where: { actor: { email: { contains: suffix } } },
    });
    expect(records.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        "LOGIN",
        "LOGOUT",
        "USER_CREATED",
        "USER_INVITED",
        "INVITE_ACCEPTED",
      ]),
    );
  });
});

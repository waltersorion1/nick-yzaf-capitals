import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { RecordService } from "../src/records/service.js";
import { ownershipPercentage, MAX_SHARES } from "../src/records/common.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL)
  throw new Error("Set a distinct, migrated TEST_DATABASE_URL");
const db = createDatabase(url),
  pool = new pg.Pool({ connectionString: url });
const Store = connectPgSimple(session),
  store = new Store({
    pool,
    tableName: "sessions",
    pruneSessionInterval: false,
  });
const app = createApp({
  db,
  store,
  secret: "day2-test-secret-at-least-32-characters",
  origin: "http://localhost:3000",
});
const admin = request.agent(app),
  a = request.agent(app),
  b = request.agent(app),
  guest = request.agent(app);
const suffix = randomBytes(8).toString("hex"),
  password = "Fictional-Password-Day2-123!";
const reason = "Fictional source register test",
  date = "2026-01-01T00:00:00.000Z",
  sourceReference = "FICTIONAL-REGISTER";
let actorId: string,
  userA: string,
  userB: string,
  companyId: string,
  ordinary: string,
  preferred: string,
  profileA: string,
  profileB: string,
  holdingA: string,
  holdingB: string;
async function mutate(
  agent: typeof admin,
  path: string,
  body: object,
  method: "post" | "patch" | "delete" = "post",
) {
  const csrf = await agent.get("/api/auth/csrf");
  return agent[method](path).set("X-CSRF-Token", csrf.body.token).send(body);
}
async function create(path: string, body: object) {
  const response = await mutate(admin, "/api/admin/" + path, {
    reason,
    ...body,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
const opening = (
  shareholderId: string,
  shareClassId: string,
  quantity: string,
) => ({
  shareholderId,
  shareClassId,
  quantity,
  verifiedAt: date,
  effectiveAt: date,
  sourceReference,
  reason,
});
const correction = (delta: string) => ({
  delta,
  effectiveAt: date,
  sourceReference,
  reason,
});
beforeAll(async () => {
  const passwordHash = await hashPassword(password);
  const owner = await db.user.create({
    data: {
      email: `d2-admin-${suffix}@example.test`,
      role: "ADMIN",
      passwordHash,
    },
  });
  actorId = owner.id;
  const ua = await db.user.create({
    data: { email: `d2-a-${suffix}@example.test`, passwordHash },
  });
  userA = ua.id;
  const ub = await db.user.create({
    data: { email: `d2-b-${suffix}@example.test`, passwordHash },
  });
  userB = ub.id;
  for (const [agent, email] of [
    [admin, owner.email],
    [a, ua.email],
    [b, ub.email],
  ] as const)
    expect(
      (await mutate(agent, "/api/auth/login", { email, password })).status,
    ).toBe(200);
  companyId = (
    await create("companies", { name: `Fictional records ${suffix}` })
  ).id;
  ordinary = (
    await create("share-classes", {
      companyId,
      name: "Ordinary",
      issuedShares: "1000",
    })
  ).id;
  preferred = (
    await create("share-classes", {
      companyId,
      name: "Preferred",
      issuedShares: "100",
    })
  ).id;
  profileA = (
    await create("shareholders", {
      userId: userA,
      legalName: "FICTIONAL Avery A",
      verifiedAt: date,
      verificationReference: sourceReference,
    })
  ).id;
  profileB = (
    await create("shareholders", {
      userId: userB,
      legalName: "FICTIONAL Blake B",
      verifiedAt: date,
      verificationReference: sourceReference,
    })
  ).id;
  holdingA = (
    await create("holdings/openings", opening(profileA, ordinary, "100"))
  ).id;
  holdingB = (
    await create("holdings/openings", opening(profileB, ordinary, "200"))
  ).id;
  await create("holdings/openings", opening(profileA, preferred, "25"));
});
afterAll(async () => {
  store.close();
  await pool.end();
  await db.$disconnect();
});
describe("Day 2 real PostgreSQL register", () => {
  it("supports admin company/class/profile reads and exact class-aware percentages", async () => {
    for (const path of [
      `companies/${companyId}`,
      `share-classes/${ordinary}`,
      `shareholders/${profileA}`,
    ])
      expect((await admin.get("/api/admin/" + path)).status).toBe(200);
    const response = await a.get("/api/me/holdings");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toHaveLength(2);
    expect(
      response.body.find((h: any) => h.shareClassId === ordinary),
    ).toMatchObject({ quantity: "100", ownershipPercentage: "10.000000" });
    expect(
      response.body.find((h: any) => h.shareClassId === preferred),
    ).toMatchObject({ quantity: "25", ownershipPercentage: "25.000000" });
    const reconciliation = await admin.get(
      `/api/admin/share-classes/${ordinary}/reconciliation`,
    );
    expect(reconciliation.body).toMatchObject({
      issuedShares: "1000",
      recordedShares: "300",
      verifiedShares: "300",
      unverifiedShares: "0",
      unrecordedShares: "700",
      ledgerShares: "300",
      reconciled: true,
      recordedPercentage: "30.000000",
    });
  });
  it("supports audited CRUD on unreferenced records", async () => {
    const company = await create("companies", {
      name: `Fictional disposable ${suffix}`,
    });
    const changed = await mutate(
      admin,
      `/api/admin/companies/${company.id}`,
      { name: `Fictional renamed ${suffix}`, reason },
      "patch",
    );
    expect(changed.status).toBe(200);
    const cls = await create("share-classes", {
      companyId: company.id,
      name: "A",
      issuedShares: "0",
    });
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${cls.id}`,
          { name: "B", issuedShares: "42", reason },
          "patch",
        )
      ).body.issuedShares,
    ).toBe("42");
    const user = await db.user.create({
      data: { email: `d2-disposable-${suffix}@example.test` },
    });
    const profile = await create("shareholders", {
      userId: user.id,
      legalName: "Fictional temporary person",
    });
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profile.id}`,
          { legalName: "Fictional corrected person", reason },
          "patch",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profile.id}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${cls.id}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/companies/${company.id}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(204);
    expect((await admin.get(`/api/admin/companies/${company.id}`)).status).toBe(
      404,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { targetId: company.id, action: "COMPANY_UPDATED" },
    });
    expect(audit.actorId).toBe(actorId);
    expect(audit.reason).toBe(reason);
    expect(audit.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.metadata).toMatchObject({
      before: { name: company.name },
      after: { name: `Fictional renamed ${suffix}` },
    });
  });
  it("blocks every administrator route for guests and shareholders", async () => {
    const paths = [
      `companies`,
      `companies/${companyId}`,
      `share-classes`,
      `share-classes/${ordinary}`,
      `share-classes/${ordinary}/reconciliation`,
      `shareholders`,
      `shareholders/${profileA}`,
      `holdings`,
      `holdings/${holdingA}`,
      `holdings/${holdingA}/events`,
      `audit-logs`,
    ];
    for (const path of paths) {
      expect((await guest.get("/api/admin/" + path)).status).toBe(401);
      expect((await a.get("/api/admin/" + path)).status).toBe(403);
    }
    const mutations: [string, "post" | "patch" | "delete"][] = [
      ["companies", "post"],
      [`companies/${companyId}`, "patch"],
      [`companies/${companyId}`, "delete"],
      ["share-classes", "post"],
      [`share-classes/${ordinary}`, "patch"],
      [`share-classes/${ordinary}`, "delete"],
      ["shareholders", "post"],
      [`shareholders/${profileA}`, "patch"],
      [`shareholders/${profileA}`, "delete"],
      ["holdings/openings", "post"],
      [`holdings/${holdingA}/adjustments`, "post"],
      [`holdings/${holdingA}/verify`, "post"],
    ];
    for (const [path, method] of mutations) {
      expect(
        (await mutate(guest, "/api/admin/" + path, {}, method)).status,
      ).toBe(401);
      expect((await mutate(a, "/api/admin/" + path, {}, method)).status).toBe(
        403,
      );
    }
    expect((await guest.get("/api/me/holdings")).status).toBe(401);
  });
  it("blocks cross-account IDs and query-based identity substitution", async () => {
    expect((await a.get(`/api/me/holdings/${holdingB}`)).status).toBe(404);
    expect((await b.get(`/api/me/holdings/${holdingA}`)).status).toBe(404);
    expect((await a.get(`/api/me/holdings/${holdingA}`)).status).toBe(200);
    expect(
      (await a.get("/api/me/holdings").query({ userId: userB })).status,
    ).toBe(400);
    expect((await a.get(`/api/admin/holdings/${holdingB}/events`)).status).toBe(
      403,
    );
  });
  it("requires CSRF on administrator changes", async () => {
    expect(
      (
        await admin
          .patch(`/api/admin/companies/${companyId}`)
          .send({ name: "Bad", reason })
      ).status,
    ).toBe(403);
  });
  it("rejects malformed, negative, fractional, unsafe numeric and oversized shares", async () => {
    for (const quantity of [
      "-1",
      "1.5",
      "1e3",
      "01",
      "9223372036854775808",
      100,
    ])
      expect(
        (
          await mutate(admin, "/api/admin/holdings/openings", {
            ...opening(profileB, preferred, "1"),
            quantity,
          })
        ).status,
      ).toBe(400);
    for (const delta of ["0", "-0", "1.2", "+1", "9223372036854775808", 1])
      expect(
        (
          await mutate(admin, `/api/admin/holdings/${holdingA}/adjustments`, {
            ...correction("1"),
            delta,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await mutate(admin, "/api/admin/share-classes", {
          companyId,
          name: "Bad",
          issuedShares: "-1",
          reason,
        })
      ).status,
    ).toBe(400);
  });
  it("rejects duplicates without creating extra ledger or audit rows", async () => {
    const events = await db.holdingEvent.count({
        where: { holdingId: holdingA },
      }),
      audits = await db.auditLog.count({ where: { targetId: holdingA } });
    expect(
      (
        await mutate(
          admin,
          "/api/admin/holdings/openings",
          opening(profileA, ordinary, "1"),
        )
      ).status,
    ).toBe(409);
    expect(
      await db.holdingEvent.count({ where: { holdingId: holdingA } }),
    ).toBe(events);
    expect(await db.auditLog.count({ where: { targetId: holdingA } })).toBe(
      audits,
    );
    expect(
      (
        await mutate(admin, "/api/admin/companies", {
          name: `Fictional records ${suffix}`,
          reason,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(admin, "/api/admin/share-classes", {
          companyId,
          name: "Ordinary",
          issuedShares: "1000",
          reason,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(admin, "/api/admin/shareholders", {
          userId: userA,
          legalName: "Duplicate person",
          reason,
        })
      ).status,
    ).toBe(409);
  });
  it("requires verified profiles and dated source evidence", async () => {
    const user = await db.user.create({
      data: { email: `d2-unverified-${suffix}@example.test` },
    });
    const profile = await create("shareholders", {
      userId: user.id,
      legalName: "FICTIONAL unverified",
    });
    expect(
      (
        await mutate(
          admin,
          "/api/admin/holdings/openings",
          opening(profile.id, ordinary, "10"),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(admin, "/api/admin/holdings/openings", {
          ...opening(profileB, preferred, "10"),
          sourceReference: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(admin, "/api/admin/holdings/openings", {
          ...opening(profileB, preferred, "10"),
          verifiedAt: "2999-01-01T00:00:00Z",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profile.id}`,
          { verifiedAt: date, reason },
          "patch",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profile.id}`,
          { verifiedAt: date, verificationReference: sourceReference, reason },
          "patch",
        )
      ).status,
    ).toBe(200);
    await create("holdings/openings", opening(profile.id, preferred, "10"));
  });
  it("appends traceable corrections and reconciles the resulting snapshots", async () => {
    expect(
      (
        await mutate(
          admin,
          `/api/admin/holdings/${holdingA}/adjustments`,
          correction("50"),
        )
      ).body.quantity,
    ).toBe("150");
    expect(
      (
        await mutate(
          admin,
          `/api/admin/holdings/${holdingA}/adjustments`,
          correction("-20"),
        )
      ).body.quantity,
    ).toBe("130");
    const history = await admin.get(`/api/admin/holdings/${holdingA}/events`);
    expect(history.status).toBe(200);
    expect(
      history.body.map((e: any) => [
        e.sequence,
        e.kind,
        e.beforeQuantity,
        e.delta,
        e.afterQuantity,
      ]),
    ).toEqual([
      [1, "OPENING", "0", "100", "100"],
      [2, "ADJUSTMENT", "100", "50", "150"],
      [3, "ADJUSTMENT", "150", "-20", "130"],
    ]);
    expect(
      history.body.every(
        (e: any) =>
          e.actorId === actorId &&
          e.reason === reason &&
          e.sourceReference === sourceReference,
      ),
    ).toBe(true);
    const reconciliation = await admin.get(
      `/api/admin/share-classes/${ordinary}/reconciliation`,
    );
    expect(reconciliation.body).toMatchObject({
      recordedShares: "330",
      ledgerShares: "330",
      reconciled: true,
    });
    expect(
      (await a.get(`/api/me/holdings/${holdingA}`)).body.ownershipPercentage,
    ).toBe("13.000000");
  });
  it("rolls back negative and over-cap corrections without changing history", async () => {
    const count = await db.holdingEvent.count({
      where: { holdingId: holdingA },
    });
    for (const delta of ["-131", "1000"])
      expect(
        (
          await mutate(
            admin,
            `/api/admin/holdings/${holdingA}/adjustments`,
            correction(delta),
          )
        ).status,
      ).toBe(409);
    expect(
      (await db.shareholding.findUniqueOrThrow({ where: { id: holdingA } }))
        .quantity,
    ).toBe(130n);
    expect(
      await db.holdingEvent.count({ where: { holdingId: holdingA } }),
    ).toBe(count);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${ordinary}`,
          { issuedShares: "329", reason },
          "patch",
        )
      ).status,
    ).toBe(409);
  });
  it("retains referenced companies, classes and profiles even for zero-balance holdings", async () => {
    expect(
      (
        await mutate(
          admin,
          `/api/admin/companies/${companyId}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${ordinary}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profileA}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/shareholders/${profileA}`,
          { userId: userB, reason },
          "patch",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${ordinary}`,
          { companyId: randomUUID(), reason },
          "patch",
        )
      ).status,
    ).toBe(400);
  });
  it("rejects direct snapshot rewrites and ledger modifications in the database", async () => {
    const event = await db.holdingEvent.findFirstOrThrow({
      where: { holdingId: holdingA },
    });
    await expect(
      db.shareholding.update({
        where: { id: holdingA },
        data: { quantity: 999n },
      }),
    ).rejects.toThrow();
    await expect(
      db.shareholding.delete({ where: { id: holdingA } }),
    ).rejects.toThrow();
    await expect(
      db.holdingEvent.update({
        where: { id: event.id },
        data: { delta: 999n },
      }),
    ).rejects.toThrow();
    await expect(
      db.holdingEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow();
    await expect(
      db.shareClass.update({
        where: { id: ordinary },
        data: { issuedShares: 1n },
      }),
    ).rejects.toThrow();
    await expect(
      db.shareholder.update({
        where: { id: profileA },
        data: { userId: userB },
      }),
    ).rejects.toThrow();
  });
  it("blocks bulk truncation of immutable evidence", async () => {
    await expect(
      db.$executeRaw`TRUNCATE TABLE holding_events`,
    ).rejects.toThrow();
    await expect(db.$executeRaw`TRUNCATE TABLE audit_logs`).rejects.toThrow();
  });
  it("serializes concurrent corrections without losing updates", async () => {
    const results = await Promise.all([
      mutate(
        admin,
        `/api/admin/holdings/${holdingA}/adjustments`,
        correction("10"),
      ),
      mutate(
        admin,
        `/api/admin/holdings/${holdingA}/adjustments`,
        correction("20"),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(
      (await db.shareholding.findUniqueOrThrow({ where: { id: holdingA } }))
        .quantity,
    ).toBe(160n);
    expect(
      (await admin.get(`/api/admin/share-classes/${ordinary}/reconciliation`))
        .body,
    ).toMatchObject({
      recordedShares: "360",
      ledgerShares: "360",
      reconciled: true,
    });
  });
  it("prevents concurrent openings from over-allocating a class", async () => {
    const cls = await create("share-classes", {
      companyId,
      name: "Concurrent capacity",
      issuedShares: "100",
    });
    const results = await Promise.all([
      mutate(
        admin,
        "/api/admin/holdings/openings",
        opening(profileA, cls.id, "60"),
      ),
      mutate(
        admin,
        "/api/admin/holdings/openings",
        opening(profileB, cls.id, "60"),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await admin.get(`/api/admin/share-classes/${cls.id}/reconciliation`))
        .body,
    ).toMatchObject({
      recordedShares: "60",
      ledgerShares: "60",
      reconciled: true,
    });
  });
  it("preserves exact arithmetic above Number.MAX_SAFE_INTEGER and handles missing denominators", async () => {
    expect(ownershipPercentage(1n, 3n)).toBe("33.333333");
    expect(ownershipPercentage(2n, 3n)).toBe("66.666667");
    expect(ownershipPercentage(0n, 0n)).toBeNull();
    expect(ownershipPercentage(MAX_SHARES, MAX_SHARES)).toBe("100.000000");
    const cls = await create("share-classes", {
      companyId,
      name: "Exact bigint",
      issuedShares: MAX_SHARES.toString(),
    });
    const holding = await create(
      "holdings/openings",
      opening(profileA, cls.id, "9007199254740993"),
    );
    const result = await a.get(`/api/me/holdings/${holding.id}`);
    expect(result.body.quantity).toBe("9007199254740993");
    expect(
      (await admin.get(`/api/admin/share-classes/${cls.id}/reconciliation`))
        .body,
    ).toMatchObject({
      recordedShares: "9007199254740993",
      ledgerShares: "9007199254740993",
      reconciled: true,
    });
    expect(result.body.ownershipPercentage).toBe(
      ownershipPercentage(9007199254740993n, MAX_SHARES),
    );
  });
  it("returns safe 404/409/400 responses for missing relations and bounded queries", async () => {
    expect(
      (await admin.get("/api/admin/companies/" + randomUUID())).status,
    ).toBe(404);
    const invalid = await mutate(admin, "/api/admin/share-classes", {
      companyId: randomUUID(),
      name: "Missing parent",
      issuedShares: "1",
      reason,
    });
    expect(invalid.status).toBe(409);
    expect(JSON.stringify(invalid.body)).not.toMatch(
      /foreign key|INSERT|Prisma|passwordHash/i,
    );
    expect((await admin.get("/api/admin/companies/not-a-uuid")).status).toBe(
      400,
    );
    expect((await admin.get("/api/admin/companies?limit=101")).status).toBe(
      400,
    );
    expect((await admin.get("/api/admin/companies?limit=1")).body).toHaveLength(
      1,
    );
  });
  it("rolls record and balance writes back if actor/audit validation fails", async () => {
    const service = new RecordService(db),
      context = { actorId: randomUUID(), requestId: randomUUID() };
    const name = `Fictional rolled back ${suffix}`;
    await expect(
      service.saveCompany(context, null, { name, reason }),
    ).rejects.toThrow();
    expect(await db.company.count({ where: { name } })).toBe(0);
    const cls = await create("share-classes", {
      companyId,
      name: "Audit rollback class",
      issuedShares: "10",
    });
    await expect(
      service.open(context, {
        ...opening(profileA, cls.id, "1"),
        quantity: 1n,
        verifiedAt: new Date(date),
        effectiveAt: new Date(date),
      }),
    ).rejects.toThrow();
    expect(
      await db.shareholding.count({ where: { shareClassId: cls.id } }),
    ).toBe(0);
    expect(
      await db.holdingEvent.count({
        where: { holding: { shareClassId: cls.id } },
      }),
    ).toBe(0);
  });
  it("allows correction to zero without deleting ownership history", async () => {
    const cls = await create("share-classes", {
      companyId,
      name: "Zero correction class",
      issuedShares: "1",
    });
    const holding = await create(
      "holdings/openings",
      opening(profileA, cls.id, "1"),
    );
    expect(
      (
        await mutate(
          admin,
          `/api/admin/holdings/${holding.id}/adjustments`,
          correction("-1"),
        )
      ).body.quantity,
    ).toBe("0");
    expect(
      (await a.get(`/api/me/holdings/${holding.id}`)).body.ownershipPercentage,
    ).toBe("0.000000");
    expect(
      (
        await mutate(
          admin,
          `/api/admin/share-classes/${cls.id}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(409);
    const empty = await create("share-classes", {
      companyId,
      name: "Unknown denominator class",
      issuedShares: "0",
    });
    expect(
      (await admin.get(`/api/admin/share-classes/${empty.id}/reconciliation`))
        .body.recordedPercentage,
    ).toBeNull();
  });
  it("audits each holding event atomically and rejects mutation endpoints", async () => {
    const events = await db.holdingEvent.findMany({
      where: { holdingId: holdingA },
      orderBy: { sequence: "asc" },
    });
    const audit = await db.auditLog.findMany({ where: { targetId: holdingA } });
    expect(audit).toHaveLength(events.length);
    expect(
      audit.every(
        (log) =>
          log.actorId === actorId &&
          log.requestId !== null &&
          log.reason === reason,
      ),
    ).toBe(true);
    expect(
      audit.some((log) => (log.metadata as any).afterQuantity === "160"),
    ).toBe(true);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/holdings/${holdingA}`,
          { quantity: "1", reason },
          "patch",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mutate(
          admin,
          `/api/admin/holdings/${holdingA}`,
          { reason },
          "delete",
        )
      ).status,
    ).toBe(404);
  });
});

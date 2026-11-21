import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db.js";
import { RecordService } from "../src/records/service.js";
import { ReportingService } from "../src/reporting/service.js";
import { hashPassword } from "../src/password.js";
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL)
  throw new Error("Use a separate migrated TEST_DATABASE_URL");
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
  secret: "reporting-test-secret-at-least-32-characters",
  origin: "http://localhost:3000",
});
const admin = request.agent(app),
  a = request.agent(app),
  b = request.agent(app),
  guest = request.agent(app);
const reason = "Fictional source record review",
  suffix = randomUUID(),
  password = "Fictional-Reporting-Password-123!",
  date = "2026-01-01",
  stamp = new Date(date + "T00:00:00Z");
let actor: string,
  userA: string,
  userB: string,
  company: string,
  otherCompany: string,
  cls: string,
  pref: string,
  profileA: string,
  profileB: string,
  announcementId: string,
  oldValue: string,
  newValue: string,
  declaration: string,
  payment: string;
async function post(agent: typeof admin, path: string, body: object) {
  const csrf = await agent.get("/api/auth/csrf");
  return agent.post(path).set("X-CSRF-Token", csrf.body.token).send(body);
}
async function create(kind: string, body: object) {
  const response = await post(admin, "/api/admin/" + kind, { reason, ...body });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
async function publish(kind: string, id: string) {
  const response = await post(admin, `/api/admin/${kind}/${id}/publish`, {
    reason,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}
const valuation = (
  shareClassId: string,
  asOf: string,
  pricePerShare: string,
  currency = "NGN",
) => ({
  shareClassId,
  asOf,
  pricePerShare,
  currency,
  methodology: "FICTIONAL source book-value methodology; illustrative only",
  sourceReference: "FICTIONAL-VALUATION",
});
const declarationData = (
  amount: string,
  reference: string,
  currency = "NGN",
) => ({
  status: "DECLARED",
  shareholderId: profileA,
  shareClassId: cls,
  amount,
  currency,
  datedAt: "2026-01-10",
  reference,
});
const paymentData = (amount: string, reference: string) => ({
  status: "PAID",
  declarationId: declaration,
  amount,
  datedAt: "2026-01-11",
  reference,
});
beforeAll(async () => {
  const hash = await hashPassword(password);
  const ua = await db.user.create({
    data: { email: `report-a-${suffix}@example.test`, passwordHash: hash },
  });
  const ub = await db.user.create({
    data: { email: `report-b-${suffix}@example.test`, passwordHash: hash },
  });
  const staff = await db.user.create({
    data: {
      email: `report-admin-${suffix}@example.test`,
      role: "ADMIN",
      passwordHash: hash,
    },
  });
  actor = staff.id;
  userA = ua.id;
  userB = ub.id;
  for (const [agent, email] of [
    [admin, staff.email],
    [a, ua.email],
    [b, ub.email],
  ] as const)
    expect(
      (await post(agent, "/api/auth/login", { email, password })).status,
    ).toBe(200);
  const service = new RecordService(db),
    context = { actorId: actor, requestId: randomUUID() };
  company = (
    await service.saveCompany(context, null, {
      name: `FICTIONAL Reporting ${suffix}`,
      reason,
    })
  ).id;
  otherCompany = (
    await service.saveCompany(context, null, {
      name: `FICTIONAL Private Company ${suffix}`,
      reason,
    })
  ).id;
  cls = (
    await service.createClass(context, {
      companyId: company,
      name: "Ordinary",
      issuedShares: 1000n,
      reason,
    })
  ).id;
  pref = (
    await service.createClass(context, {
      companyId: company,
      name: "Preferred",
      issuedShares: 1000n,
      reason,
    })
  ).id;
  const privateClass = (
    await service.createClass(context, {
      companyId: otherCompany,
      name: "Private",
      issuedShares: 1000n,
      reason,
    })
  ).id;
  profileA = (
    await service.createProfile(context, {
      userId: userA,
      legalName: "FICTIONAL Reporting A",
      verifiedAt: stamp,
      verificationReference: "FICTIONAL-LEGAL-SOURCE",
      reason,
    })
  ).id;
  profileB = (
    await service.createProfile(context, {
      userId: userB,
      legalName: "FICTIONAL Reporting B",
      verifiedAt: stamp,
      verificationReference: "FICTIONAL-LEGAL-SOURCE",
      reason,
    })
  ).id;
  for (const [shareholderId, shareClassId, quantity] of [
    [profileA, cls, 3n],
    [profileB, pref, 2n],
    [profileB, privateClass, 5n],
  ] as const)
    await service.open(context, {
      shareholderId,
      shareClassId,
      quantity,
      verifiedAt: stamp,
      effectiveAt: stamp,
      sourceReference: "FICTIONAL-REGISTER",
      reason,
    });
});
afterAll(async () => {
  store.close();
  await pool.end();
  await db.$disconnect();
});
describe("Day 4 reporting with real PostgreSQL sessions and decimal amounts", () => {
  it("keeps missing valuations missing", async () => {
    const response = await a.get("/api/me/valuation-summary");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      positionCount: 1,
      missingCount: 1,
      complete: false,
      totals: [],
      positions: [{ valuation: null, indicativeValue: null }],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("requires roles and CSRF on all report mutations and reads", async () => {
    for (const kind of ["announcements", "valuations", "dividend-records"]) {
      expect((await guest.get("/api/admin/" + kind)).status).toBe(401);
      expect((await a.get("/api/admin/" + kind)).status).toBe(403);
      for (const path of [
        kind,
        `${kind}/${randomUUID()}/publish`,
        `${kind}/${randomUUID()}/withdraw`,
      ]) {
        expect((await post(guest, "/api/admin/" + path, {})).status).toBe(401);
        expect((await post(a, "/api/admin/" + path, {})).status).toBe(403);
      }
    }
    expect((await admin.post("/api/admin/announcements").send({})).status).toBe(
      403,
    );
    expect(
      (await guest.get(`/api/companies/${company}/valuations`)).status,
    ).toBe(401);
    expect((await guest.get("/api/me/dividends")).status).toBe(401);
  });
  it("publishes announcements privately with source date and audit trail", async () => {
    const row = await create("announcements", {
      companyId: company,
      title: "FICTIONAL source update",
      body: "Fictional private company update only.",
      datedAt: date,
      sourceReference: "FICTIONAL-ANNOUNCEMENT",
    });
    announcementId = row.id;
    expect(
      (await a.get(`/api/companies/${company}/announcements`)).body,
    ).toEqual([]);
    await publish("announcements", row.id);
    const response = await a.get(`/api/companies/${company}/announcements`);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].title).toBe("FICTIONAL source update");
    expect(
      (await a.get(`/api/companies/${otherCompany}/announcements`)).status,
    ).toBe(404);
    expect(
      (
        await post(admin, `/api/admin/announcements/${row.id}/publish`, {
          reason,
        })
      ).status,
    ).toBe(409);
  });
  it("validates actual dates, methodology, fiat currency and exact price scale", async () => {
    const base = valuation(cls, "2026-02-01", "0.2");
    for (const change of [
      { asOf: "2026-02-30" },
      { asOf: "2999-01-01" },
      { asOf: "1899-01-01" },
      { asOf: "2026-01-01T00:00:00Z" },
      { pricePerShare: "-1" },
      { pricePerShare: "0.123456789" },
      { pricePerShare: 0.2 },
      { pricePerShare: "NaN" },
      { currency: "BTC" },
      { methodology: "short" },
    ])
      expect(
        (
          await post(admin, "/api/admin/valuations", {
            ...base,
            ...change,
            reason,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await post(admin, "/api/admin/announcements", {
          companyId: company,
          title: "Bad",
          body: "Bad date",
          datedAt: "2026-02-30",
          sourceReference: "FICTIONAL",
          reason,
        })
      ).status,
    ).toBe(400);
  });
  it("uses latest published class snapshot, not newer drafts, with exact multiplication", async () => {
    oldValue = (await create("valuations", valuation(cls, "2026-01-01", "0.1")))
      .id;
    newValue = (await create("valuations", valuation(cls, "2026-02-01", "0.2")))
      .id;
    await create("valuations", valuation(cls, "2026-03-01", "999"));
    await publish("valuations", oldValue);
    await publish("valuations", newValue);
    const summary = (await a.get("/api/me/valuation-summary")).body;
    expect(summary).toMatchObject({
      complete: true,
      missingCount: 0,
      totals: [{ currency: "NGN", amount: "0.60000000" }],
    });
    expect(summary.positions[0].valuation.pricePerShare).toBe("0.20000000");
    expect(summary.positions[0].indicativeValue).toBe("0.60000000");
    expect(summary.label).toContain("not a live market quote");
    expect(
      (await a.get(`/api/companies/${company}/valuations`)).body,
    ).toHaveLength(2);
    expect(
      (
        await post(admin, "/api/admin/valuations", {
          ...valuation(cls, "2026-02-01", "1"),
          reason,
        })
      ).status,
    ).toBe(409);
  });
  it("isolates classes within a company and rejects foreign company and identity queries", async () => {
    const value = await create(
      "valuations",
      valuation(pref, "2026-01-01", "99"),
    );
    await publish("valuations", value.id);
    expect(
      (await a.get(`/api/companies/${company}/valuations`)).body.every(
        (row: any) => row.shareClassId === cls,
      ),
    ).toBe(true);
    expect(
      (await b.get(`/api/companies/${company}/valuations`)).body.map(
        (row: any) => row.shareClassId,
      ),
    ).toEqual([pref]);
    expect(
      (await a.get(`/api/companies/${otherCompany}/valuations`)).status,
    ).toBe(404);
    expect(
      (await a.get("/api/me/valuation-summary?userId=" + userB)).status,
    ).toBe(400);
    expect(
      (await a.get("/api/me/dividends?shareholderId=" + profileB)).status,
    ).toBe(400);
  });
  it("withdraws and replaces source records without mutating history", async () => {
    expect(
      (
        await post(admin, `/api/admin/valuations/${newValue}/withdraw`, {
          reason,
        })
      ).status,
    ).toBe(200);
    expect(
      (await a.get("/api/me/valuation-summary")).body.totals[0].amount,
    ).toBe("0.30000000");
    const corrected = await create(
      "valuations",
      valuation(cls, "2026-02-01", "0.25"),
    );
    await publish("valuations", corrected.id);
    expect(
      (await a.get("/api/me/valuation-summary")).body.totals[0].amount,
    ).toBe("0.75000000");
    expect(
      (
        await post(admin, `/api/admin/valuations/${newValue}/publish`, {
          reason,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await db.valuationSnapshot.findUniqueOrThrow({
          where: { id: newValue },
        })
      ).pricePerShare.toString(),
    ).toBe("0.2");
    expect(
      (
        await post(
          admin,
          `/api/admin/announcements/${announcementId}/withdraw`,
          { reason },
        )
      ).status,
    ).toBe(200);
    expect(
      (await a.get(`/api/companies/${company}/announcements`)).body,
    ).toEqual([]);
  });
  it("keeps mixed currencies separate and preserves large exact share multiplication", async () => {
    const service = new RecordService(db),
      context = { actorId: actor, requestId: randomUUID() };
    const extra = await service.createClass(context, {
      companyId: company,
      name: "Exact large class",
      issuedShares: 9223372036854775807n,
      reason,
    });
    await service.open(context, {
      shareholderId: profileA,
      shareClassId: extra.id,
      quantity: 9007199254740993n,
      verifiedAt: stamp,
      effectiveAt: stamp,
      sourceReference: "FICTIONAL-BIGINT",
      reason,
    });
    const row = await create(
      "valuations",
      valuation(extra.id, "2026-01-01", "0.00000001", "USD"),
    );
    await publish("valuations", row.id);
    const summary = (await a.get("/api/me/valuation-summary")).body;
    expect(summary.complete).toBe(true);
    expect(summary.totals).toEqual(
      expect.arrayContaining([
        { currency: "NGN", amount: "0.75000000" },
        { currency: "USD", amount: "90071992.54740993" },
      ]),
    );
    expect(
      summary.positions.find((p: any) => p.shareClassId === extra.id)
        .indicativeValue,
    ).toBe("90071992.54740993");
  });
  it("records declarations and payments separately; draft payments do not count as paid", async () => {
    declaration = (
      await create(
        "dividend-records",
        declarationData("100.10", "FICTIONAL-DECLARATION"),
      )
    ).id;
    expect((await a.get("/api/me/dividends")).body).toEqual([]);
    await publish("dividend-records", declaration);
    let totals = (await a.get("/api/me/dividend-totals")).body;
    expect(totals.totals).toEqual([
      { currency: "NGN", declared: "100.10000000", paid: "0.00000000" },
    ]);
    payment = (
      await create(
        "dividend-records",
        paymentData("40.01", "FICTIONAL-PAYMENT"),
      )
    ).id;
    expect((await a.get("/api/me/dividend-totals")).body.totals[0].paid).toBe(
      "0.00000000",
    );
    await publish("dividend-records", payment);
    totals = (await a.get("/api/me/dividend-totals")).body;
    expect(totals.totals).toEqual([
      { currency: "NGN", declared: "100.10000000", paid: "40.01000000" },
    ]);
    expect(totals.label).toContain("no payment execution");
    expect(totals).not.toHaveProperty("balance");
    expect(
      (await a.get("/api/me/dividends")).body
        .map((row: any) => row.status)
        .sort(),
    ).toEqual(["DECLARED", "PAID"]);
    expect((await b.get("/api/me/dividends")).body).toEqual([]);
  });
  it("rejects duplicate references, overpayments, wrong dates, zero/negative amounts and field spoofing", async () => {
    for (const body of [
      { ...paymentData("1", "FICTIONAL-PAYMENT") },
      { ...paymentData("60.10", "FICTIONAL-OVERPAY") },
      { ...paymentData("1", "FICTIONAL-EARLY"), datedAt: "2026-01-09" },
    ])
      expect(
        (await post(admin, "/api/admin/dividend-records", { ...body, reason }))
          .status,
      ).toBe(409);
    for (const change of [
      { amount: "0" },
      { amount: "-1" },
      { amount: "1.000000001" },
      { amount: 1 },
      { datedAt: "2999-01-01" },
      { shareholderId: profileB },
      { currency: "USD" },
    ])
      expect(
        (
          await post(admin, "/api/admin/dividend-records", {
            ...paymentData("1", "FICTIONAL-BAD"),
            ...change,
            reason,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await post(admin, "/api/admin/dividend-records", {
          ...declarationData("1", "FICTIONAL-WRONG-CLASS"),
          shareClassId: pref,
          reason,
        })
      ).status,
    ).toBe(409);
  });
  it("serializes concurrent payment records so a declaration cannot be overpaid", async () => {
    const parent = await create(
      "dividend-records",
      declarationData("10", "FICTIONAL-CONCURRENT", "EUR"),
    );
    await publish("dividend-records", parent.id);
    const input = {
      status: "PAID",
      declarationId: parent.id,
      amount: "7",
      datedAt: "2026-01-11",
      reason,
    };
    const results = await Promise.all([
      post(admin, "/api/admin/dividend-records", {
        ...input,
        reference: "FICTIONAL-C1",
      }),
      post(admin, "/api/admin/dividend-records", {
        ...input,
        reference: "FICTIONAL-C2",
      }),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 409]);
    expect(
      (
        await db.dividendRecord.aggregate({
          where: { declarationId: parent.id },
          _sum: { amount: true },
        })
      )._sum.amount!.toString(),
    ).toBe("7");
  });
  it("requires payment withdrawals before withdrawing the declaration and updates totals", async () => {
    expect(
      (
        await post(
          admin,
          `/api/admin/dividend-records/${declaration}/withdraw`,
          { reason },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(admin, `/api/admin/dividend-records/${payment}/withdraw`, {
          reason,
        })
      ).status,
    ).toBe(200);
    expect(
      (await a.get("/api/me/dividend-totals")).body.totals.find(
        (row: any) => row.currency === "NGN",
      ),
    ).toMatchObject({ declared: "100.10000000", paid: "0.00000000" });
    expect(
      (
        await post(
          admin,
          `/api/admin/dividend-records/${declaration}/withdraw`,
          { reason },
        )
      ).status,
    ).toBe(200);
    expect(
      (await a.get("/api/me/dividends")).body.some(
        (row: any) => row.id === declaration || row.id === payment,
      ),
    ).toBe(false);
  });
  it("retains immutable source records and rejects raw database inconsistencies", async () => {
    await expect(
      db.announcement.update({
        where: { id: announcementId },
        data: { title: "Changed" },
      }),
    ).rejects.toThrow();
    await expect(
      db.announcement.delete({ where: { id: announcementId } }),
    ).rejects.toThrow();
    await expect(
      db.valuationSnapshot.update({
        where: { id: oldValue },
        data: { pricePerShare: "999" },
      }),
    ).rejects.toThrow();
    await expect(
      db.dividendRecord.update({
        where: { id: declaration },
        data: { amount: "1" },
      }),
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`TRUNCATE TABLE valuation_snapshots`,
    ).rejects.toThrow();
    await expect(
      db.dividendRecord.create({
        data: {
          shareholderId: profileB,
          shareClassId: pref,
          status: "PAID",
          declarationId: declaration,
          amount: "1",
          currency: "USD",
          datedAt: stamp,
          reference: "FICTIONAL-SQL-BAD",
        },
      }),
    ).rejects.toThrow();
  });
  it("rolls back an unauditable draft and records every successful lifecycle transition", async () => {
    const service = new ReportingService(db);
    await expect(
      service.createValuation(
        { actorId: randomUUID(), requestId: randomUUID() },
        {
          ...valuation(cls, "2025-01-01", "10"),
          currency: "NGN",
          asOf: new Date("2025-01-01T00:00:00Z"),
          reason,
        },
      ),
    ).rejects.toThrow();
    expect(
      await db.valuationSnapshot.count({
        where: { shareClassId: cls, asOf: new Date("2025-01-01T00:00:00Z") },
      }),
    ).toBe(0);
    const records = await db.auditLog.findMany({
      where: { targetId: announcementId },
      orderBy: { createdAt: "asc" },
    });
    expect(records).toHaveLength(3);
    expect(
      records.every(
        (row) =>
          row.actorId === actor && row.reason === reason && row.requestId,
      ),
    ).toBe(true);
    expect(records.map((row) => row.action)).toEqual([
      "ANNOUNCEMENT_CREATED",
      "ANNOUNCEMENTS_PUBLISH",
      "ANNOUNCEMENTS_WITHDRAW",
    ]);
    expect(records[1].metadata).toMatchObject({
      before: { publishedAt: null },
      after: { title: "FICTIONAL source update" },
    });
  });
  it("supports explicit zero valuation without replacing missing valuations with zero", async () => {
    const zero = await create("valuations", valuation(cls, "2026-04-01", "0"));
    await publish("valuations", zero.id);
    const summary = (await a.get("/api/me/valuation-summary")).body;
    expect(
      summary.positions.find((row: any) => row.shareClassId === cls)
        .indicativeValue,
    ).toBe("0.00000000");
  });
});

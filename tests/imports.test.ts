import "dotenv/config";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/password.js";
import { RecordService } from "../src/records/service.js";
import { ImportService } from "../src/imports/service.js";
import { HEADERS } from "../src/imports/csv.js";
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
  secret: "import-test-secret-at-least-32-characters",
  origin: "http://localhost:3000",
});
const admin = request.agent(app),
  otherAdmin = request.agent(app),
  member = request.agent(app),
  guest = request.agent(app),
  suffix = randomUUID(),
  password = "Fictional-CSV-Password-123!",
  reason = "Fictional source register import",
  stamp = new Date("2026-01-01T00:00:00Z");
let actor: string,
  secondActor: string,
  company: string,
  otherCompany: string,
  a: string,
  b: string,
  c: string,
  unverified: string,
  inactive: string;
async function post(agent: typeof admin, path: string, body: object) {
  const csrf = await agent.get("/api/auth/csrf");
  return agent.post(path).set("X-CSRF-Token", csrf.body.token).send(body);
}
const context = () => ({ actorId: actor, requestId: randomUUID() });
const cell = (value: string) =>
  /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
function csv(rows: Record<string, string>[], headers = HEADERS) {
  return (
    headers.join(",") +
    "\n" +
    rows
      .map((row) => headers.map((key) => cell(row[key] ?? "")).join(","))
      .join("\n") +
    "\n"
  );
}
function row(
  cls: string,
  holder: string,
  quantity = "100",
  expected = "350",
  issued = "1000",
) {
  return {
    company_id: company,
    share_class_id: cls,
    shareholder_id: holder,
    quantity,
    verified_at: stamp.toISOString(),
    effective_at: stamp.toISOString(),
    source_reference: 'FICTIONAL register, "signed copy"',
    class_issued_shares: issued,
    expected_class_recorded_shares: expected,
  };
}
async function fixture(existing = true, issued = 1000n) {
  const records = new RecordService(db),
    cls = await records.createClass(context(), {
      companyId: company,
      name: "CSV " + randomUUID(),
      issuedShares: issued,
      reason,
    });
  if (existing)
    await records.open(context(), {
      shareholderId: c,
      shareClassId: cls.id,
      quantity: 50n,
      verifiedAt: stamp,
      effectiveAt: stamp,
      sourceReference: "FICTIONAL-EXISTING",
      reason,
    });
  return { cls: cls.id, csv: csv([row(cls.id, a), row(cls.id, b, "200")]) };
}
async function preview(text: string, agent = admin) {
  const response = await post(agent, "/api/admin/imports/preview", {
    csv: text,
    reason,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body;
}
async function commit(batchId: string, agent = admin) {
  return post(agent, `/api/admin/imports/${batchId}/commit`, { confirm: true });
}
beforeAll(async () => {
  const hash = await hashPassword(password);
  const ua = await db.user.create({
    data: {
      email: `csv-admin-${suffix}@example.test`,
      role: "ADMIN",
      passwordHash: hash,
    },
  });
  actor = ua.id;
  const ub = await db.user.create({
    data: {
      email: `csv-admin2-${suffix}@example.test`,
      role: "ADMIN",
      passwordHash: hash,
    },
  });
  secondActor = ub.id;
  const user = await db.user.create({
    data: { email: `csv-member-${suffix}@example.test`, passwordHash: hash },
  });
  for (const [agent, email] of [
    [admin, ua.email],
    [otherAdmin, ub.email],
    [member, user.email],
  ] as const)
    expect(
      (await post(agent, "/api/auth/login", { email, password })).status,
    ).toBe(200);
  const records = new RecordService(db);
  company = (
    await records.saveCompany(context(), null, {
      name: "FICTIONAL CSV company " + suffix,
      reason,
    })
  ).id;
  otherCompany = (
    await records.saveCompany(context(), null, {
      name: "FICTIONAL wrong mapping " + suffix,
      reason,
    })
  ).id;
  const profiles = [];
  for (let i = 0; i < 5; i++) {
    const account = await db.user.create({
      data: { email: `csv-person-${i}-${suffix}@example.test` },
    });
    const holder = await records.createProfile(context(), {
      userId: account.id,
      legalName: "FICTIONAL CSV person " + i,
      ...(i === 3
        ? {}
        : { verifiedAt: stamp, verificationReference: "FICTIONAL-PROFILE" }),
      reason,
    });
    profiles.push(holder.id);
    if (i === 4)
      await db.user.update({
        where: { id: account.id },
        data: { active: false },
      });
  }
  [a, b, c, unverified, inactive] = profiles;
});
afterAll(async () => {
  store.close();
  await pool.end();
  await db.$disconnect();
});
describe("Day 5 CSV preview, atomic import and idempotent receipts", () => {
  it("restricts template, history, reports, user mappings and mutations to active administrators", async () => {
    for (const path of [
      "/api/admin/imports/template",
      "/api/admin/imports",
      "/api/admin/imports/" + randomUUID(),
      "/api/admin/users",
    ]) {
      expect((await guest.get(path)).status).toBe(401);
      expect((await member.get(path)).status).toBe(403);
    }
    for (const path of [
      "/api/admin/imports/preview",
      "/api/admin/imports/" + randomUUID() + "/commit",
    ]) {
      expect((await post(guest, path, {})).status).toBe(401);
      expect((await post(member, path, {})).status).toBe(403);
    }
    expect(
      (
        await admin
          .post("/api/admin/imports/preview")
          .send({ csv: "bad", reason })
      ).status,
    ).toBe(403);
    const template = await admin.get("/api/admin/imports/template");
    expect(template.status).toBe(200);
    expect(template.text.trim()).toBe(HEADERS.join(","));
    expect(template.headers["cache-control"]).toBe("no-store");
    const users = await admin.get("/api/admin/users");
    expect(users.status).toBe(200);
    expect(JSON.stringify(users.body)).not.toMatch(
      /passwordHash|inviteHash|SESSION_SECRET/,
    );
  });
  it("previews quoted UTF-8 CSV, mappings and exact reconciliation without financial writes", async () => {
    const f = await fixture();
    const result = await preview(f.csv);
    expect(result.report.canCommit).toBe(true);
    expect(result.report.rows.map((row: any) => row.line)).toEqual([2, 3]);
    expect(result.report.rows[0].values.source_reference).toBe(
      'FICTIONAL register, "signed copy"',
    );
    expect(result.report.rows[0].shareholderName).toContain("FICTIONAL");
    expect(result.report.reconciliations[0]).toMatchObject({
      issuedShares: "1000",
      recordedBefore: "50",
      importShares: "300",
      recordedAfter: "350",
      expectedRecorded: "350",
      unrecordedAfter: "650",
      ledgerBefore: "50",
      errors: [],
    });
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
    expect(
      await db.holdingEvent.count({
        where: { holding: { shareClassId: f.cls } },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { targetId: result.batchId, action: "IMPORT_PREVIEW" },
      }),
    ).toBe(1);
  });
  it("returns row-level errors for missing IDs, invalid quantities, dates and source evidence", async () => {
    const f = await fixture();
    for (const change of [
      { company_id: "" },
      { share_class_id: "bad" },
      { shareholder_id: "" },
      { quantity: "-1" },
      { quantity: "0" },
      { quantity: "1.5" },
      { quantity: "1e3" },
      { quantity: "9223372036854775808" },
      { verified_at: "2999-01-01T00:00:00Z" },
      { effective_at: "not-a-date" },
      { source_reference: "" },
    ]) {
      const batch = await preview(csv([{ ...row(f.cls, a), ...change }]));
      expect(batch.report.canCommit).toBe(false);
      expect(batch.report.rows[0].errors.length).toBeGreaterThan(0);
      expect((await commit(batch.batchId)).status).toBe(409);
    }
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
  });
  it("rejects unknown and mismatched company/class/profile IDs, unverified and inactive profiles", async () => {
    const f = await fixture();
    for (const change of [
      { company_id: otherCompany },
      { company_id: randomUUID() },
      { share_class_id: randomUUID() },
      { shareholder_id: randomUUID() },
      { shareholder_id: unverified },
      { shareholder_id: inactive },
    ]) {
      const batch = await preview(
        csv([{ ...row(f.cls, a, "100", "150"), ...change }]),
      );
      expect(batch.report.canCommit).toBe(false);
      expect(batch.report.rows[0].errors.length).toBeGreaterThan(0);
    }
  });
  it("rejects duplicate pairs, including existing zero-balance records, without skipping rows", async () => {
    const f = await fixture();
    const duplicate = await preview(csv([row(f.cls, a), row(f.cls, a, "200")]));
    expect(
      duplicate.report.rows.every((row: any) =>
        row.errors.some((error: any) => error.code === "DUPLICATE_FILE"),
      ),
    ).toBe(true);
    await new RecordService(db).adjust(
      context(),
      (
        await db.shareholding.findUniqueOrThrow({
          where: {
            shareholderId_shareClassId: {
              shareholderId: c,
              shareClassId: f.cls,
            },
          },
        })
      ).id,
      {
        delta: -50n,
        effectiveAt: stamp,
        sourceReference: "FICTIONAL-ZERO",
        reason,
      },
    );
    const existing = await preview(csv([row(f.cls, c, "100", "100")]));
    expect(
      existing.report.rows[0].errors.some(
        (error: any) => error.code === "EXISTING_HOLDING",
      ),
    ).toBe(true);
    expect((await commit(existing.batchId)).status).toBe(409);
  });
  it("rejects wrong issued/expected totals, inconsistent rows and over-allocation", async () => {
    const f = await fixture();
    for (const rows of [
      [row(f.cls, a, "100", "150", "999")],
      [row(f.cls, a, "100", "151")],
      [row(f.cls, a), row(f.cls, b, "200", "351")],
      [row(f.cls, a, "1000", "1050")],
    ]) {
      const batch = await preview(csv(rows));
      expect(batch.report.canCommit).toBe(false);
      expect(batch.report.reconciliations[0].errors.length).toBeGreaterThan(0);
    }
  });
  it("rejects malformed headers/quotes, empty data, extra cells and oversized uploads", async () => {
    const f = await fixture();
    for (const text of [
      "wrong,headers\n1,2",
      HEADERS.join(","),
      HEADERS.join(",") + '\n"unterminated',
      HEADERS.join(",") +
        "\n" +
        Object.values(row(f.cls, a)).join(",") +
        ",extra",
    ]) {
      const batch = await preview(text);
      expect(batch.report.canCommit).toBe(false);
    }
    const many = await preview(
      csv(Array.from({ length: 201 }, () => row(f.cls, a))),
    );
    expect(many.report.globalErrors.join(" ")).toContain("200");
    const huge = await post(admin, "/api/admin/imports/preview", {
      csv: "x".repeat(131073),
      reason,
    });
    expect(huge.status).toBe(400);
    expect(
      (
        await post(admin, "/api/admin/imports/preview", {
          csv: "x".repeat(300000),
          reason,
        })
      ).status,
    ).toBe(413);
  });
  it("commits every row, opening event and audit together and returns exact totals", async () => {
    const f = await fixture();
    const batch = await preview(f.csv),
      result = await commit(batch.batchId);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.receipt.rowCount).toBe(2);
    expect(result.body.receipt.holdingIds).toHaveLength(2);
    expect(result.body.replayed).toBe(false);
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(3);
    expect(await new RecordService(db).reconcile(f.cls)).toMatchObject({
      recordedShares: 350n,
      ledgerShares: 350n,
      reconciled: true,
    });
    expect(
      await db.auditLog.count({
        where: { targetId: batch.batchId, action: "IMPORT_COMMITTED" },
      }),
    ).toBe(1);
    const events = await db.holdingEvent.findMany({
      where: { holdingId: { in: result.body.receipt.holdingIds } },
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { targetId: batch.batchId, action: "IMPORT_COMMITTED" },
    });
    expect(
      events.every(
        (event) =>
          event.requestId === audit.requestId && event.actorId === actor,
      ),
    ).toBe(true);
  });
  it("replays repeated commits/uploads (including BOM/CRLF) without duplicate holdings or events", async () => {
    const f = await fixture(),
      batch = await preview(f.csv),
      first = await commit(batch.batchId);
    expect(first.status).toBe(200);
    const again = await commit(batch.batchId.toUpperCase());
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.receipt).toEqual(first.body.receipt);
    const uploaded = await preview("\uFEFF" + f.csv.replaceAll("\n", "\r\n"));
    expect(uploaded.batchId).toBe(batch.batchId);
    expect(uploaded.replayed).toBe(true);
    expect(
      await db.holdingEvent.count({
        where: { holding: { shareClassId: f.cls } },
      }),
    ).toBe(3);
    const reordered = await preview(csv([row(f.cls, b, "200"), row(f.cls, a)]));
    expect(reordered.report.canCommit).toBe(false);
    expect((await commit(reordered.batchId)).status).toBe(409);
  });
  it("binds preview tokens to their creator and refuses client-controlled rows/confirmation omissions", async () => {
    const f = await fixture(),
      batch = await preview(f.csv);
    expect(
      (await otherAdmin.get("/api/admin/imports/" + batch.batchId)).status,
    ).toBe(404);
    expect((await commit(batch.batchId, otherAdmin)).status).toBe(404);
    expect(
      (
        await post(admin, `/api/admin/imports/${batch.batchId}/commit`, {
          confirm: true,
          csv: f.csv,
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(admin, `/api/admin/imports/${batch.batchId}/commit`, {}))
        .status,
    ).toBe(400);
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
  });
  it("revalidates changed balances and mapping names instead of trusting a prior preview", async () => {
    const f = await fixture(),
      batch = await preview(f.csv);
    const holding = await db.shareholding.findUniqueOrThrow({
      where: {
        shareholderId_shareClassId: { shareholderId: c, shareClassId: f.cls },
      },
    });
    await new RecordService(db).adjust(context(), holding.id, {
      delta: 1n,
      effectiveAt: stamp,
      sourceReference: "FICTIONAL-CHANGED",
      reason,
    });
    const result = await commit(batch.batchId);
    expect(result.status).toBe(409);
    expect(result.body.report.canCommit).toBe(false);
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
    const other = await fixture(),
      previewed = await preview(other.csv);
    await new RecordService(db).updateClass(context(), other.cls, {
      name: "Renamed " + randomUUID(),
      reason,
    });
    const changed = await commit(previewed.batchId);
    expect(changed.status).toBe(409);
    expect(changed.body.report.globalErrors.join(" ")).toContain(
      "changed since preview",
    );
  });
  it("expires uncommitted previews without changing financial records", async () => {
    const f = await fixture(),
      batch = await preview(f.csv);
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 31 * 60000);
    try {
      await expect(
        new ImportService(db).commit(context(), batch.batchId),
      ).rejects.toThrow("Preview expired");
    } finally {
      clock.mockRestore();
    }
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
  });
  it("serializes two previews of the same file into one commit plus a replay receipt", async () => {
    const f = await fixture(),
      one = await preview(f.csv),
      two = await preview(f.csv);
    const results = await Promise.all([
      commit(one.batchId),
      commit(two.batchId),
    ]);
    expect(results.map((row) => row.status)).toEqual([200, 200]);
    expect(results.map((row) => row.body.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].body.receipt).toEqual(results[1].body.receipt);
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(3);
  });
  it("serializes competing files so class capacity cannot be over-allocated", async () => {
    const f = await fixture(false);
    const one = await preview(csv([row(f.cls, a, "600", "600")])),
      two = await preview(csv([row(f.cls, b, "600", "600")]));
    expect(one.report.canCommit && two.report.canCommit).toBe(true);
    const results = await Promise.all([
      commit(one.batchId),
      commit(two.batchId),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    expect((await new RecordService(db).reconcile(f.cls)).recordedShares).toBe(
      600n,
    );
  });
  it("rolls earlier rows/events back when a later row hits a real database failure", async () => {
    const f = await fixture(),
      batch = await preview(f.csv),
      name = "csv_fail_" + randomUUID().replaceAll("-", "");
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."shareClassId"='${f.cls}'::uuid AND NEW."shareholderId"='${b}'::uuid THEN RAISE EXCEPTION 'Fictional injected late-row failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON shareholdings FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      expect((await commit(batch.batchId)).status).toBe(409);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON shareholdings`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
    expect(
      await db.holdingEvent.count({
        where: { holding: { shareClassId: f.cls } },
      }),
    ).toBe(1);
    expect(
      (
        await db.openingImportBatch.findUniqueOrThrow({
          where: { id: batch.batchId },
        })
      ).committedAt,
    ).toBeNull();
    expect(
      await db.auditLog.count({
        where: { targetId: batch.batchId, action: "IMPORT_FAILED" },
      }),
    ).toBe(1);
    expect((await commit(batch.batchId)).status).toBe(200);
  });
  it("rolls the whole import back if the final commit audit cannot be written", async () => {
    const f = await fixture(),
      batch = await preview(f.csv),
      name = "csv_audit_" + randomUUID().replaceAll("-", "");
    await pool.query(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='IMPORT_COMMITTED' AND NEW."targetId"='${batch.batchId}' THEN RAISE EXCEPTION 'Fictional injected audit failure' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      expect((await commit(batch.batchId)).status).toBe(409);
    } finally {
      await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
      await pool.query(`DROP FUNCTION ${name}()`);
    }
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(1);
    expect(
      await db.holdingEvent.count({
        where: { holding: { shareClassId: f.cls } },
      }),
    ).toBe(1);
    expect(
      (
        await db.openingImportBatch.findUniqueOrThrow({
          where: { id: batch.batchId },
        })
      ).receipt,
    ).toBeNull();
  });
  it("reconciles multiple companies/classes independently in one atomic file", async () => {
    const f = await fixture();
    const other = await new RecordService(db).createClass(context(), {
      companyId: otherCompany,
      name: "CSV other " + randomUUID(),
      issuedShares: 2000n,
      reason,
    });
    const batch = await preview(
      csv([
        row(f.cls, a, "100", "150"),
        { ...row(other.id, b, "200", "200", "2000"), company_id: otherCompany },
      ]),
    );
    expect(batch.report.canCommit).toBe(true);
    expect(batch.report.reconciliations).toHaveLength(2);
    expect((await commit(batch.batchId)).status).toBe(200);
    expect((await new RecordService(db).reconcile(f.cls)).recordedShares).toBe(
      150n,
    );
    expect(
      (await new RecordService(db).reconcile(other.id)).recordedShares,
    ).toBe(200n);
  });
  it("does not let another administrator reuse a committed file as new openings", async () => {
    const f = await fixture(),
      first = await preview(f.csv);
    expect((await commit(first.batchId)).status).toBe(200);
    const second = await preview(f.csv, otherAdmin);
    expect(second.report.canCommit).toBe(false);
    expect((await commit(second.batchId, otherAdmin)).status).toBe(409);
    expect(
      await db.shareholding.count({ where: { shareClassId: f.cls } }),
    ).toBe(3);
  });
  it("retains immutable import evidence and exact large share quantities", async () => {
    const f = await fixture(false, 9223372036854775807n);
    const large = "9007199254740993",
      batch = await preview(
        csv([row(f.cls, a, large, large, "9223372036854775807")]),
      );
    expect(batch.report.canCommit).toBe(true);
    expect((await commit(batch.batchId)).status).toBe(200);
    expect((await new RecordService(db).reconcile(f.cls)).recordedShares).toBe(
      9007199254740993n,
    );
    await expect(
      db.openingImportBatch.update({
        where: { id: batch.batchId },
        data: { csvText: "changed" },
      }),
    ).rejects.toThrow();
    await expect(
      db.openingImportBatch.delete({ where: { id: batch.batchId } }),
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`TRUNCATE TABLE opening_import_batches`,
    ).rejects.toThrow();
  });
});

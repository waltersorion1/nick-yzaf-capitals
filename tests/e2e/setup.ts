import { randomUUID } from "node:crypto";
import { createDatabase } from "../../src/db.js";
import { RecordService } from "../../src/records/service.js";
import { hashPassword } from "../../src/password.js";
export default async function setup() {
  const db = createDatabase(process.env.TEST_DATABASE_URL!);
  try {
    const password = "Fictional-browser-password-123!",
      suffix = randomUUID();
    const passwordHash = await hashPassword(password);
    const admin = await db.user.create({
      data: {
        email: `e2e-admin-${suffix}@example.test`,
        role: "ADMIN",
        passwordHash,
      },
    });
    const member = await db.user.create({
      data: { email: `e2e-a-${suffix}@example.test`, passwordHash },
    });
    const other = await db.user.create({
      data: { email: `e2e-b-${suffix}@example.test`, passwordHash },
    });
    const empty = await db.user.create({
      data: { email: `e2e-empty-${suffix}@example.test`, passwordHash },
    });
    const service = new RecordService(db),
      context = { actorId: admin.id, requestId: randomUUID() },
      reason = "Fictional browser fixture";
    const company = await service.saveCompany(context, null, {
      name: `FICTIONAL Browser Company ${suffix}`,
      reason,
    });
    const cls = await service.createClass(context, {
      companyId: company.id,
      name: "Ordinary",
      issuedShares: 1000n,
      reason,
    });
    const verification = {
      verifiedAt: new Date("2026-01-01T00:00:00Z"),
      verificationReference: "FICTIONAL-PROFILE",
      reason,
    };
    const a = await service.createProfile(context, {
      userId: member.id,
      legalName: "FICTIONAL Browser A",
      ...verification,
    });
    const b = await service.createProfile(context, {
      userId: other.id,
      legalName: "FICTIONAL Browser B",
      ...verification,
    });
    const evidence = {
      verifiedAt: verification.verifiedAt,
      effectiveAt: verification.verifiedAt,
      sourceReference: "FICTIONAL-REGISTER",
      reason,
    };
    const own = await service.open(context, {
      shareholderId: a.id,
      shareClassId: cls.id,
      quantity: 100n,
      ...evidence,
    });
    const theirs = await service.open(context, {
      shareholderId: b.id,
      shareClassId: cls.id,
      quantity: 200n,
      ...evidence,
    });
    process.env.E2E_FIXTURE = JSON.stringify({
      admin: admin.email,
      member: member.email,
      other: other.email,
      empty: empty.email,
      password,
      company: company.name,
      companyId: company.id,
      own: own.id,
      theirs: theirs.id,
    });
  } finally {
    await db.$disconnect();
  }
}

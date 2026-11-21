import "dotenv/config";
import { createDatabase } from "../src/db.js";
import { randomUUID } from "node:crypto";
import { RecordService } from "../src/records/service.js";
import { hashPassword } from "../src/password.js";
const db = createDatabase(process.env.DATABASE_URL ?? "");
try {
  if (process.env.NODE_ENV === "production")
    throw new Error("Fictional seed forbidden in production");
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.length > 128)
    throw new Error("Set SEED_ADMIN_PASSWORD (12–128 characters)");
  const passwordHash = await hashPassword(password);
  const demoClasses: { id: string; shareholderId: string; actorId: string }[] =
    [];
  await db.$transaction(async (tx) => {
    const admin = await tx.user.upsert({
      where: { email: "admin@example.test" },
      update: {},
      create: { email: "admin@example.test", role: "ADMIN", passwordHash },
    });
    const user = await tx.user.upsert({
      where: { email: "shareholder@example.test" },
      update: {},
      create: { email: "shareholder@example.test", passwordHash },
    });
    const holder = await tx.shareholder.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        legalName: "FICTIONAL — Avery Sample",
        verifiedAt: new Date("2026-01-01T00:00:00Z"),
        verificationReference: "FICTIONAL-DEMO-PROFILE",
      },
    });
    if (
      !holder.verificationReference &&
      holder.legalName === "FICTIONAL \u2014 Avery Sample"
    ) {
      await tx.shareholder.update({
        where: { id: holder.id },
        data: {
          verifiedAt: new Date("2026-01-01T00:00:00Z"),
          verificationReference: "FICTIONAL-DEMO-PROFILE",
        },
      });
    }
    for (const name of [
      "Fictional Creations Demo",
      "Fictional TV Demo",
      "Fictional Games Demo",
    ]) {
      const company = await tx.company.upsert({
        where: { name },
        update: {},
        create: { name },
      });
      const cls = await tx.shareClass.upsert({
        where: { companyId_name: { companyId: company.id, name: "Ordinary" } },
        update: {},
        create: {
          companyId: company.id,
          name: "Ordinary",
          issuedShares: 1000n,
        },
      });
      // Store IDs for ledger writes after this metadata transaction commits.
      demoClasses.push({
        id: cls.id,
        shareholderId: holder.id,
        actorId: admin.id,
      });
    }
    await tx.auditLog.create({
      data: { action: "FICTIONAL_DEVELOPMENT_SEED" },
    });
  });
  const service = new RecordService(db);
  for (const cls of demoClasses) {
    const context = { actorId: cls.actorId, requestId: randomUUID() };
    const existing = await db.shareholding.findUnique({
      where: {
        shareholderId_shareClassId: {
          shareholderId: cls.shareholderId,
          shareClassId: cls.id,
        },
      },
    });
    const evidence = {
      verifiedAt: new Date("2026-01-01T00:00:00Z"),
      effectiveAt: new Date("2026-01-01T00:00:00Z"),
      sourceReference: "FICTIONAL-DEMO-REGISTER",
      reason: "Fictional development fixture; not a real legal register",
    };
    if (!existing)
      await service.open(context, {
        shareholderId: cls.shareholderId,
        shareClassId: cls.id,
        quantity: 100n,
        ...evidence,
      });
    else if (!existing.verifiedAt)
      await service.verify(context, existing.id, evidence);
  }
  console.log(
    "Fictional demo records seeded; existing credentials were not overwritten.",
  );
} finally {
  await db.$disconnect();
}

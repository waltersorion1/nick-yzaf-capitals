import "dotenv/config";
import { createDatabase } from "../src/db.js";
import { hashPassword } from "../src/password.js";
const db = createDatabase(process.env.DATABASE_URL ?? "");
try {
  if (process.env.NODE_ENV === "production")
    throw new Error("Fictional seed forbidden in production");
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.length > 128)
    throw new Error("Set SEED_ADMIN_PASSWORD (12–128 characters)");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    await tx.user.upsert({
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
      },
    });
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
      await tx.shareholding.upsert({
        where: {
          shareholderId_shareClassId: {
            shareholderId: holder.id,
            shareClassId: cls.id,
          },
        },
        update: {},
        create: {
          shareholderId: holder.id,
          shareClassId: cls.id,
          quantity: 100n,
        },
      });
    }
    await tx.auditLog.create({
      data: { action: "FICTIONAL_DEVELOPMENT_SEED" },
    });
  });
  console.log(
    "Fictional demo records seeded; existing credentials were not overwritten.",
  );
} finally {
  await db.$disconnect();
}

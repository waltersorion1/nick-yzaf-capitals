import { readFileSync } from "node:fs";
import { z } from "zod";
import { createDatabase } from "../db.js";
import { readConfig } from "../config.js";
import { hashPassword } from "../password.js";
const config = readConfig();
const email = z
  .string()
  .email()
  .max(254)
  .parse(process.env.BOOTSTRAP_ADMIN_EMAIL)
  .toLowerCase();
const password = z
  .string()
  .min(12)
  .max(128)
  .parse(
    readFileSync(process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE!, "utf8").trim(),
  );
if (process.env.ALLOW_ADMIN_BOOTSTRAP !== "1")
  throw new Error("Explicit ALLOW_ADMIN_BOOTSTRAP=1 required");
const db = createDatabase(config.DATABASE_URL);
try {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    // A transaction advisory lock serializes simultaneous first-owner provisioning.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(6141701)`;
    if (await tx.user.count())
      throw new Error("Bootstrap is restricted to an empty user register");
    const user = await tx.user.create({
      data: { email, role: "ADMIN", passwordHash },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "OWNER_BOOTSTRAPPED",
        targetId: user.id,
        targetType: "user",
        reason: "First owner provisioned through private operations command",
      },
    });
  });
  console.log('{"event":"owner_bootstrap_complete"}');
} finally {
  await db.$disconnect();
}

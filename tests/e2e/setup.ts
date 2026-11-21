import { randomUUID } from "node:crypto";
import { createDatabase } from "../../src/db.js";
import { ReportingService } from "../../src/reporting/service.js";
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
    const reporter = await db.user.create({
      data: { email: `e2e-report-${suffix}@example.test`, passwordHash },
    });
    const reportCompany = await service.saveCompany(context, null, {
      name: `FICTIONAL Reporting Company ${suffix}`,
      reason,
    });
    const reportClass = await service.createClass(context, {
      companyId: reportCompany.id,
      name: "Ordinary",
      issuedShares: 1000n,
      reason,
    });
    const reportProfile = await service.createProfile(context, {
      userId: reporter.id,
      legalName: "FICTIONAL Report Reader",
      ...verification,
    });
    await service.open(context, {
      shareholderId: reportProfile.id,
      shareClassId: reportClass.id,
      quantity: 4n,
      ...evidence,
    });
    const reporting = new ReportingService(db);
    const announcement = await reporting.createAnnouncement(context, {
      companyId: reportCompany.id,
      title: "FICTIONAL published report update",
      body: "FICTIONAL private announcement body",
      datedAt: verification.verifiedAt,
      sourceReference: "FICTIONAL-BROWSER-ANNOUNCEMENT",
      reason,
    });
    await reporting.transition(
      context,
      "announcements",
      announcement.id,
      "publish",
      reason,
    );
    for (const [asOf, price] of [
      ["2026-01-01", "2.5"],
      ["2026-01-02", "3.25"],
    ] as const) {
      const snapshot = await reporting.createValuation(context, {
        shareClassId: reportClass.id,
        asOf: new Date(asOf + "T00:00:00Z"),
        pricePerShare: price,
        currency: "NGN",
        methodology: "FICTIONAL source methodology with independent limits",
        sourceReference: "FICTIONAL-BROWSER-VALUE",
        reason,
      });
      await reporting.transition(
        context,
        "valuations",
        snapshot.id,
        "publish",
        reason,
      );
    }
    await reporting.createValuation(context, {
      shareClassId: reportClass.id,
      asOf: new Date("2026-01-03T00:00:00Z"),
      pricePerShare: "999",
      currency: "NGN",
      methodology: "FICTIONAL draft not visible to readers",
      sourceReference: "FICTIONAL-DRAFT",
      reason,
    });
    const declaration = await reporting.createDividend(context, {
      status: "DECLARED",
      shareholderId: reportProfile.id,
      shareClassId: reportClass.id,
      amount: "100",
      currency: "NGN",
      datedAt: verification.verifiedAt,
      reference: "FICTIONAL-BROWSER-DECLARATION",
      reason,
    });
    await reporting.transition(
      context,
      "dividend-records",
      declaration.id,
      "publish",
      reason,
    );
    const payment = await reporting.createDividend(context, {
      status: "PAID",
      declarationId: declaration.id,
      amount: "40",
      datedAt: verification.verifiedAt,
      reference: "FICTIONAL-BROWSER-PAYMENT",
      reason,
    });
    await reporting.transition(
      context,
      "dividend-records",
      payment.id,
      "publish",
      reason,
    );
    process.env.E2E_FIXTURE = JSON.stringify({
      reportDeclaration: declaration.id,
      reporter: reporter.email,
      reportCompany: reportCompany.name,
      reportCompanyId: reportCompany.id,
      reportClass: reportClass.id,
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

import { Prisma, PrismaClient, type OpeningImportBatch } from "@prisma/client";
import { parseCsv, contentHash, digest, type CsvRow } from "./csv.js";
import {
  RecordError,
  audit,
  jsonSnapshot,
  type AuditContext,
} from "../records/common.js";
import { RecordService } from "../records/service.js";
export interface PreviewRow extends CsvRow {
  companyName?: string;
  shareClassName?: string;
  shareholderName?: string;
  profileState?: string;
}
export interface ClassTotal {
  companyId: string;
  companyName: string;
  shareClassId: string;
  shareClassName: string;
  issuedShares: string;
  recordedBefore: string;
  importShares: string;
  recordedAfter: string;
  expectedRecorded: string;
  unrecordedAfter: string;
  ledgerBefore: string;
  errors: string[];
}
export interface ImportReport {
  canCommit: boolean;
  globalErrors: string[];
  rows: PreviewRow[];
  reconciliations: ClassTotal[];
}
function view(batch: OpeningImportBatch) {
  return {
    batchId: batch.id,
    contentHash: batch.contentHash,
    createdAt: batch.createdAt,
    expiresAt: batch.expiresAt,
    committedAt: batch.committedAt,
    report: batch.preview,
    receipt: batch.receipt,
  };
}
function summary(report: ImportReport) {
  return {
    rowCount: report.rows.length,
    valid: report.canCommit,
    errorRows: report.rows.filter((row) => row.errors.length).length,
    reconciliations: report.reconciliations,
  };
}
export class ImportService {
  constructor(private db: PrismaClient) {}
  async validate(
    tx: Prisma.TransactionClient,
    csv: string,
    lock = false,
  ): Promise<ImportReport> {
    const parsed = parseCsv(csv);
    const report: ImportReport = {
      ...parsed,
      canCommit: false,
      reconciliations: [],
    };
    const candidates = report.rows.filter((row) => !row.errors.length);
    const classIds = [
      ...new Set(candidates.map((row) => row.values.share_class_id)),
    ].sort();
    const profileIds = [
      ...new Set(candidates.map((row) => row.values.shareholder_id)),
    ].sort();
    if (lock) {
      for (const id of classIds)
        await tx.$queryRaw`SELECT id FROM share_classes WHERE id=${id}::uuid FOR UPDATE`;
      for (const id of profileIds)
        await tx.$queryRaw`SELECT id FROM shareholders WHERE id=${id}::uuid FOR SHARE`;
    }
    const classes = await tx.shareClass.findMany({
      where: { id: { in: classIds } },
      include: { company: true },
      orderBy: { id: "asc" },
    });
    const companies = await tx.company.findMany({
      where: {
        id: {
          in: [...new Set(candidates.map((row) => row.values.company_id))],
        },
      },
    });
    const profiles = await tx.shareholder.findMany({
      where: { id: { in: profileIds } },
      include: { user: { select: { id: true, role: true, active: true } } },
    });
    const existing = candidates.length
      ? await tx.shareholding.findMany({
          where: {
            OR: candidates.map((row) => ({
              shareholderId: row.values.shareholder_id,
              shareClassId: row.values.share_class_id,
            })),
          },
          select: { shareholderId: true, shareClassId: true },
        })
      : [];
    const pairs = new Map<string, number[]>();
    for (const row of candidates) {
      const key = row.values.shareholder_id + "/" + row.values.share_class_id;
      pairs.set(key, [...(pairs.get(key) ?? []), row.line]);
    }
    for (const row of candidates) {
      const v = row.values,
        cls = classes.find((item) => item.id === v.share_class_id),
        company = companies.find((item) => item.id === v.company_id),
        holder = profiles.find((item) => item.id === v.shareholder_id);
      const error = (field: string, code: string, message: string) =>
        row.errors.push({ field, code, message });
      if (!company)
        error("company_id", "COMPANY_NOT_FOUND", "Company ID does not exist.");
      else row.companyName = company.name;
      if (!cls)
        error(
          "share_class_id",
          "CLASS_NOT_FOUND",
          "Share class ID does not exist.",
        );
      else {
        row.shareClassName = cls.name;
        if (cls.companyId !== v.company_id)
          error(
            "share_class_id",
            "COMPANY_CLASS_MISMATCH",
            "Share class belongs to a different company.",
          );
      }
      if (!holder)
        error(
          "shareholder_id",
          "PROFILE_NOT_FOUND",
          "Shareholder profile ID does not exist.",
        );
      else {
        row.shareholderName = holder.legalName;
        row.profileState = JSON.stringify([
          holder.user.id,
          holder.verifiedAt?.toISOString(),
          holder.verificationReference,
          holder.user.role,
          holder.user.active,
        ]);
        if (!holder.verifiedAt || !holder.verificationReference)
          error(
            "shareholder_id",
            "UNVERIFIED_PROFILE",
            "Verify the shareholder profile and its source before importing.",
          );
        if (holder.user.role !== "SHAREHOLDER" || !holder.user.active)
          error(
            "shareholder_id",
            "INACTIVE_ACCOUNT",
            "An active shareholder account is required.",
          );
      }
      if (pairs.get(v.shareholder_id + "/" + v.share_class_id)!.length > 1)
        error(
          "shareholder_id",
          "DUPLICATE_FILE",
          "Duplicate shareholder/class pair in this file.",
        );
      if (
        existing.some(
          (item) =>
            item.shareholderId === v.shareholder_id &&
            item.shareClassId === v.share_class_id,
        )
      )
        error(
          "shareholder_id",
          "EXISTING_HOLDING",
          "Holding already exists, including zero balances. Use an audited correction instead.",
        );
    }
    for (const cls of classes) {
      const rows = candidates.filter(
        (row) => row.values.share_class_id === cls.id,
      );
      const imported = rows.reduce(
        (sum, row) => sum + BigInt(row.values.quantity),
        0n,
      );
      const recorded =
        (
          await tx.shareholding.aggregate({
            where: { shareClassId: cls.id },
            _sum: { quantity: true },
          })
        )._sum.quantity ?? 0n;
      const ledger =
        (
          await tx.holdingEvent.aggregate({
            where: { holding: { shareClassId: cls.id } },
            _sum: { delta: true },
          })
        )._sum.delta ?? 0n;
      const after = recorded + imported,
        expected = rows[0].values.expected_class_recorded_shares;
      const errors: string[] = [];
      if (
        rows.some(
          (row) => BigInt(row.values.class_issued_shares) !== cls.issuedShares,
        )
      )
        errors.push("CSV issued shares do not match this class register.");
      if (
        rows.some(
          (row) => row.values.expected_class_recorded_shares !== expected,
        )
      )
        errors.push(
          "Expected recorded total is inconsistent between rows of this class.",
        );
      if (after !== BigInt(expected))
        errors.push(
          "Existing recorded shares plus this file do not match the source expected recorded total.",
        );
      if (after > cls.issuedShares)
        errors.push("Import would exceed the class issued-share total.");
      if (ledger !== recorded)
        errors.push(
          "Existing ledger and snapshot totals do not reconcile. Stop and investigate.",
        );
      for (const row of rows)
        for (const message of errors)
          row.errors.push({
            field: "reconciliation",
            code: "CLASS_RECONCILIATION",
            message,
          });
      report.reconciliations.push({
        companyId: cls.companyId,
        companyName: cls.company.name,
        shareClassId: cls.id,
        shareClassName: cls.name,
        issuedShares: cls.issuedShares.toString(),
        recordedBefore: recorded.toString(),
        importShares: imported.toString(),
        recordedAfter: after.toString(),
        expectedRecorded: expected,
        unrecordedAfter: (cls.issuedShares - after).toString(),
        ledgerBefore: ledger.toString(),
        errors,
      });
    }
    report.canCommit =
      !report.globalErrors.length &&
      report.rows.length > 0 &&
      report.rows.every((row) => !row.errors.length);
    return report;
  }
  private async replay(
    tx: Prisma.TransactionClient,
    context: AuditContext,
    batch: OpeningImportBatch,
  ) {
    if (batch.actorId !== context.actorId)
      throw new RecordError(
        409,
        "This file was already committed by another administrator. Refresh the register.",
      );
    await audit(
      tx,
      context,
      "IMPORT_REPLAY",
      "opening_import",
      batch.id,
      batch.reason,
      null,
      { contentHash: batch.contentHash },
    );
    return { ...view(batch), replayed: true };
  }
  async preview(context: AuditContext, input: { csv: string; reason: string }) {
    return this.db.$transaction(
      async (tx) => {
        const hash = contentHash(input.csv),
          previous = await tx.openingImportBatch.findFirst({
            where: {
              actorId: context.actorId,
              contentHash: hash,
              committedAt: { not: null },
            },
          });
        if (previous) return this.replay(tx, context, previous);
        const report = await this.validate(tx, input.csv);
        const expiresAt = new Date(Date.now() + 30 * 60000);
        const batch = await tx.openingImportBatch.create({
          data: {
            actorId: context.actorId,
            contentHash: hash,
            csvText: input.csv,
            reason: input.reason,
            preview: jsonSnapshot(report),
            previewDigest: digest(JSON.stringify(report)),
            expiresAt,
          },
        });
        await audit(
          tx,
          context,
          "IMPORT_PREVIEW",
          "opening_import",
          batch.id,
          input.reason,
          null,
          { contentHash: hash, expiresAt, ...summary(report) },
        );
        return { ...view(batch), replayed: false };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 30000,
        maxWait: 10000,
      },
    );
  }
  async get(actorId: string, id: string) {
    id = id.toLowerCase();
    const batch = await this.db.openingImportBatch.findFirstOrThrow({
      where: { id, actorId },
    });
    const receipt = !batch.committedAt
      ? await this.db.openingImportBatch.findFirst({
          where: {
            actorId,
            contentHash: batch.contentHash,
            committedAt: { not: null },
          },
        })
      : null;
    return view(receipt ?? batch);
  }
  async commit(context: AuditContext, id: string) {
    id = id.toLowerCase();
    try {
      return await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM opening_import_batches WHERE id=${id}::uuid AND "actorId"=${context.actorId}::uuid FOR UPDATE`;
          const batch = await tx.openingImportBatch.findFirstOrThrow({
            where: { id, actorId: context.actorId },
          });
          if (batch.committedAt) return this.replay(tx, context, batch);
          const prior = await tx.openingImportBatch.findFirst({
            where: {
              contentHash: batch.contentHash,
              committedAt: { not: null },
            },
          });
          if (prior) return this.replay(tx, context, prior);
          if (batch.expiresAt.getTime() <= Date.now())
            throw new RecordError(
              409,
              "Preview expired. Upload and review the file again.",
            );
          await tx.$queryRaw`SELECT id FROM users WHERE id=${context.actorId}::uuid FOR SHARE`;
          const report = await this.validate(tx, batch.csvText, true);
          // A competing same-file commit may have completed while class locks were acquired.
          const competing = await tx.openingImportBatch.findFirst({
            where: {
              contentHash: batch.contentHash,
              committedAt: { not: null },
            },
          });
          if (competing) return this.replay(tx, context, competing);
          if (
            !report.canCommit ||
            digest(JSON.stringify(report)) !== batch.previewDigest
          ) {
            if (report.canCommit) {
              report.canCommit = false;
              report.globalErrors.push(
                "Register data changed since preview. Preview the file again and review the new totals.",
              );
            }
            await audit(
              tx,
              context,
              "IMPORT_REJECTED",
              "opening_import",
              id,
              batch.reason,
              null,
              summary(report),
            );
            return { ...view(batch), report, conflict: true, replayed: false };
          }
          const records = new RecordService(this.db),
            holdingIds: string[] = [];
          for (const row of report.rows) {
            const v = row.values;
            const holding = await records.openInTransaction(tx, context, {
              shareholderId: v.shareholder_id,
              shareClassId: v.share_class_id,
              quantity: BigInt(v.quantity),
              verifiedAt: new Date(v.verified_at),
              effectiveAt: new Date(v.effective_at),
              sourceReference: v.source_reference,
              reason: batch.reason,
            });
            holdingIds.push(holding.id);
          }
          for (const total of report.reconciliations) {
            const recorded =
              (
                await tx.shareholding.aggregate({
                  where: { shareClassId: total.shareClassId },
                  _sum: { quantity: true },
                })
              )._sum.quantity ?? 0n;
            const ledger =
              (
                await tx.holdingEvent.aggregate({
                  where: { holding: { shareClassId: total.shareClassId } },
                  _sum: { delta: true },
                })
              )._sum.delta ?? 0n;
            if (
              recorded !== BigInt(total.expectedRecorded) ||
              ledger !== recorded
            )
              throw new RecordError(
                409,
                "Post-import reconciliation failed. No rows were committed.",
              );
          }
          const committedAt = new Date(),
            receipt = {
              batchId: id,
              contentHash: batch.contentHash,
              rowCount: holdingIds.length,
              holdingIds,
              committedAt: committedAt.toISOString(),
              reconciliations: report.reconciliations,
            };
          const committed = await tx.openingImportBatch.update({
            where: { id },
            data: {
              committedAt,
              commitRequestId: context.requestId,
              receipt: jsonSnapshot(receipt),
            },
          });
          await audit(
            tx,
            context,
            "IMPORT_COMMITTED",
            "opening_import",
            id,
            batch.reason,
            null,
            receipt,
          );
          return { ...view(committed), replayed: false };
        },
        { timeout: 30000, maxWait: 10000 },
      );
    } catch (error) {
      const own = await this.db.openingImportBatch
        .findFirst({
          where: { id, actorId: context.actorId },
          select: { reason: true },
        })
        .catch(() => null);
      if (own)
        await audit(
          this.db,
          context,
          "IMPORT_FAILED",
          "opening_import",
          id,
          own.reason,
          null,
          { message: "Commit failed; the import transaction was rolled back." },
        ).catch(() => {});
      throw error;
    }
  }
}

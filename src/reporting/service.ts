import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import * as schema from "./validation.js";
import { audit, RecordError, type AuditContext } from "../records/common.js";
Prisma.Decimal.set({ precision: 65 });
export type ReportingKind = z.infer<typeof schema.kind>;
const visible = { publishedAt: { not: null }, withdrawnAt: null };
export class ReportingService {
  constructor(private db: PrismaClient) {}
  async createAnnouncement(
    context: AuditContext,
    input: z.infer<typeof schema.announcement>,
  ) {
    return this.db.$transaction(async (tx) => {
      const { reason, ...data } = input;
      const record = await tx.announcement.create({ data });
      await audit(
        tx,
        context,
        "ANNOUNCEMENT_CREATED",
        "announcement",
        record.id,
        reason,
        null,
        record,
      );
      return record;
    });
  }
  async createValuation(
    context: AuditContext,
    input: z.infer<typeof schema.valuation>,
  ) {
    return this.db.$transaction(async (tx) => {
      const { reason, ...data } = input;
      const record = await tx.valuationSnapshot.create({ data });
      await audit(
        tx,
        context,
        "VALUATION_CREATED",
        "valuation",
        record.id,
        reason,
        null,
        record,
      );
      return record;
    });
  }
  async createDividend(
    context: AuditContext,
    input: z.infer<typeof schema.dividend>,
  ) {
    return this.db.$transaction(async (tx) => {
      let shareholderId: string,
        shareClassId: string,
        currency: string,
        declarationId: string | null = null;
      if (input.status === "PAID") {
        await tx.$queryRaw`SELECT id FROM dividend_records WHERE id=${input.declarationId}::uuid FOR UPDATE`;
        const parent = await tx.dividendRecord.findUniqueOrThrow({
          where: { id: input.declarationId },
        });
        if (
          parent.status !== "DECLARED" ||
          !parent.publishedAt ||
          parent.withdrawnAt
        )
          throw new RecordError(
            409,
            "An active published declaration is required",
          );
        if (input.datedAt < parent.datedAt)
          throw new RecordError(
            409,
            "Payment date cannot precede declaration date",
          );
        const prior = await tx.dividendRecord.aggregate({
          where: { declarationId: parent.id, withdrawnAt: null },
          _sum: { amount: true },
        });
        if (
          new Prisma.Decimal(prior._sum.amount ?? 0)
            .plus(input.amount)
            .greaterThan(parent.amount)
        )
          throw new RecordError(
            409,
            "Payment records would exceed the declaration",
          );
        shareholderId = parent.shareholderId;
        shareClassId = parent.shareClassId;
        currency = parent.currency;
        declarationId = parent.id;
      } else {
        shareholderId = input.shareholderId;
        shareClassId = input.shareClassId;
        currency = input.currency;
        const holding = await tx.shareholding.findUnique({
          where: {
            shareholderId_shareClassId: { shareholderId, shareClassId },
          },
          include: { shareholder: true },
        });
        if (!holding?.verifiedAt || !holding.shareholder.verificationReference)
          throw new RecordError(
            409,
            "A verified existing or historical holding is required",
          );
      }
      const record = await tx.dividendRecord.create({
        data: {
          shareholderId,
          shareClassId,
          currency,
          declarationId,
          status: input.status,
          amount: input.amount,
          datedAt: input.datedAt,
          reference: input.reference,
        },
      });
      await audit(
        tx,
        context,
        "DIVIDEND_CREATED",
        "dividend",
        record.id,
        input.reason,
        null,
        record,
      );
      return record;
    });
  }
  async transition(
    context: AuditContext,
    kind: ReportingKind,
    id: string,
    action: "publish" | "withdraw",
    reason: string,
  ) {
    return this.db.$transaction(async (tx) => {
      // Static table identifiers only; UUIDs are always bound parameters.
      if (kind === "announcements")
        await tx.$queryRaw`SELECT id FROM announcements WHERE id=${id}::uuid FOR UPDATE`;
      else if (kind === "valuations")
        await tx.$queryRaw`SELECT id FROM valuation_snapshots WHERE id=${id}::uuid FOR UPDATE`;
      else {
        // Use parent-before-child order, matching payment creation and the database trigger.
        const child = await tx.dividendRecord.findUniqueOrThrow({
          where: { id },
        });
        if (child.declarationId)
          await tx.$queryRaw`SELECT id FROM dividend_records WHERE id=${child.declarationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM dividend_records WHERE id=${id}::uuid FOR UPDATE`;
      }
      const before =
        kind === "announcements"
          ? await tx.announcement.findUniqueOrThrow({ where: { id } })
          : kind === "valuations"
            ? await tx.valuationSnapshot.findUniqueOrThrow({ where: { id } })
            : await tx.dividendRecord.findUniqueOrThrow({ where: { id } });
      if (before.withdrawnAt || (action === "publish" && before.publishedAt))
        throw new RecordError(
          409,
          "Report has already been published or withdrawn",
        );
      if (kind === "dividend-records" && action === "withdraw") {
        if (
          await tx.dividendRecord.count({
            where: { declarationId: id, withdrawnAt: null },
          })
        )
          throw new RecordError(409, "Withdraw linked payment records first");
      }
      const data =
        action === "publish"
          ? { publishedAt: new Date() }
          : { withdrawnAt: new Date() };
      const after =
        kind === "announcements"
          ? await tx.announcement.update({ where: { id }, data })
          : kind === "valuations"
            ? await tx.valuationSnapshot.update({ where: { id }, data })
            : await tx.dividendRecord.update({ where: { id }, data });
      await audit(
        tx,
        context,
        `${kind.toUpperCase().replace("-", "_")}_${action.toUpperCase()}`,
        kind,
        id,
        reason,
        before,
        after,
      );
      return after;
    });
  }
  async companyVisibility(
    tx: Prisma.TransactionClient,
    userId: string,
    companyId: string,
  ) {
    const holding = await tx.shareholding.findFirst({
      where: {
        shareholder: { userId },
        shareClass: { companyId },
        verifiedAt: { not: null },
        quantity: { gt: 0n },
      },
      select: { id: true },
    });
    if (!holding) throw new RecordError(404, "Company not found");
  }
  async announcements(
    userId: string,
    companyId: string,
    limit: number,
    offset: number,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.companyVisibility(tx, userId, companyId);
        return tx.announcement.findMany({
          where: { companyId, ...visible },
          orderBy: [{ datedAt: "desc" }, { id: "asc" }],
          take: limit,
          skip: offset,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async valuations(
    userId: string,
    companyId: string,
    limit: number,
    offset: number,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.companyVisibility(tx, userId, companyId);
        return tx.valuationSnapshot.findMany({
          where: {
            ...visible,
            shareClass: {
              companyId,
              holdings: {
                some: {
                  shareholder: { userId },
                  verifiedAt: { not: null },
                  quantity: { gt: 0n },
                },
              },
            },
          },
          include: { shareClass: { select: { name: true } } },
          orderBy: [{ asOf: "asc" }, { id: "asc" }],
          take: limit,
          skip: offset,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async summary(userId: string, companyId?: string) {
    return this.db.$transaction(
      async (tx) => {
        const holdings = await tx.shareholding.findMany({
          where: {
            shareholder: { userId },
            verifiedAt: { not: null },
            quantity: { gt: 0n },
            shareClass: { companyId },
          },
          include: { shareClass: { select: { name: true } } },
          orderBy: { id: "asc" },
        });
        const snapshots = await tx.valuationSnapshot.findMany({
          where: {
            shareClassId: { in: holdings.map((h) => h.shareClassId) },
            ...visible,
          },
          orderBy: { asOf: "desc" },
          distinct: ["shareClassId"],
        });
        const latest = new Map(
          snapshots.map((snapshot) => [snapshot.shareClassId, snapshot]),
        );
        const totals = new Map<string, Prisma.Decimal>();
        const positions = [];
        let missingCount = 0;
        for (const holding of holdings) {
          const snapshot = latest.get(holding.shareClassId);
          if (!snapshot) {
            missingCount++;
            positions.push({
              holdingId: holding.id,
              shareClassId: holding.shareClassId,
              quantity: holding.quantity.toString(),
              valuation: null,
              indicativeValue: null,
            });
            continue;
          }
          const value = snapshot.pricePerShare.times(
            holding.quantity.toString(),
          );
          totals.set(
            snapshot.currency,
            (totals.get(snapshot.currency) ?? new Prisma.Decimal(0)).plus(
              value,
            ),
          );
          positions.push({
            holdingId: holding.id,
            shareClassId: holding.shareClassId,
            quantity: holding.quantity.toString(),
            valuation: snapshot,
            indicativeValue: value.toFixed(8),
          });
        }
        return {
          label: "Indicative only - not a live market quote",
          positionCount: holdings.length,
          missingCount,
          complete: holdings.length > 0 && missingCount === 0,
          totals: [...totals].map(([currency, amount]) => ({
            currency,
            amount: amount.toFixed(8),
          })),
          positions,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async dividends(
    userId: string,
    companyId: string | undefined,
    limit: number,
    offset: number,
  ) {
    return this.db.dividendRecord.findMany({
      where: {
        shareholder: { userId },
        shareClass: { companyId },
        ...visible,
        OR: [{ status: "DECLARED" }, { declaration: { ...visible } }],
      },
      include: { shareClass: { include: { company: true } } },
      orderBy: [{ datedAt: "desc" }, { id: "asc" }],
      take: limit,
      skip: offset,
    });
  }
  async dividendTotals(userId: string, companyId?: string) {
    const rows = await this.db.dividendRecord.groupBy({
      by: ["currency", "status"],
      where: {
        shareholder: { userId },
        shareClass: { companyId },
        ...visible,
        OR: [{ status: "DECLARED" }, { declaration: { ...visible } }],
      },
      _sum: { amount: true },
    });
    const totals = new Map<
      string,
      { currency: string; declared: string; paid: string }
    >();
    for (const row of rows) {
      const item = totals.get(row.currency) ?? {
        currency: row.currency,
        declared: "0.00000000",
        paid: "0.00000000",
      };
      item[row.status === "DECLARED" ? "declared" : "paid"] =
        row._sum.amount!.toFixed(8);
      totals.set(row.currency, item);
    }
    return {
      label: "Historical records only; no payment execution or wallet balance",
      totals: [...totals.values()],
    };
  }
}

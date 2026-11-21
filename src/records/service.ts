import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import * as schema from "./validation.js";
import {
  audit,
  type AuditContext,
  RecordError,
  MAX_SHARES,
  ownershipPercentage,
} from "./common.js";
export class RecordService {
  constructor(private db: PrismaClient) {}
  async saveCompany(
    context: AuditContext,
    id: string | null,
    input: z.infer<typeof schema.companyCreate>,
  ) {
    return this.db.$transaction(async (tx) => {
      if (id)
        await tx.$queryRaw`SELECT id FROM companies WHERE id=${id}::uuid FOR UPDATE`;
      const before = id
        ? await tx.company.findUniqueOrThrow({ where: { id } })
        : null;
      const after = id
        ? await tx.company.update({ where: { id }, data: { name: input.name } })
        : await tx.company.create({ data: { name: input.name } });
      await audit(
        tx,
        context,
        id ? "COMPANY_UPDATED" : "COMPANY_CREATED",
        "company",
        after.id,
        input.reason,
        before,
        after,
      );
      return after;
    });
  }
  async deleteCompany(context: AuditContext, id: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM companies WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.company.delete({ where: { id } });
      await audit(
        tx,
        context,
        "COMPANY_DELETED",
        "company",
        id,
        reason,
        before,
        null,
      );
    });
  }
  async createClass(
    context: AuditContext,
    input: z.infer<typeof schema.classCreate>,
  ) {
    return this.db.$transaction(async (tx) => {
      const { reason, ...data } = input;
      const after = await tx.shareClass.create({ data });
      await audit(
        tx,
        context,
        "CLASS_CREATED",
        "share_class",
        after.id,
        reason,
        null,
        after,
      );
      return after;
    });
  }
  async updateClass(
    context: AuditContext,
    id: string,
    input: z.infer<typeof schema.classUpdate>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM share_classes WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.shareClass.findUniqueOrThrow({ where: { id } });
      if (input.issuedShares !== undefined) {
        const aggregate = await tx.shareholding.aggregate({
          where: { shareClassId: id },
          _sum: { quantity: true },
        });
        if (input.issuedShares < (aggregate._sum.quantity ?? 0n))
          throw new RecordError(
            409,
            "Class total cannot be below recorded holdings",
          );
      }
      const { reason, ...data } = input;
      const after = await tx.shareClass.update({ where: { id }, data });
      await audit(
        tx,
        context,
        "CLASS_UPDATED",
        "share_class",
        id,
        reason,
        before,
        after,
      );
      return after;
    });
  }
  async deleteClass(context: AuditContext, id: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM share_classes WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.shareClass.delete({ where: { id } });
      await audit(
        tx,
        context,
        "CLASS_DELETED",
        "share_class",
        id,
        reason,
        before,
        null,
      );
    });
  }
  async createProfile(
    context: AuditContext,
    input: z.infer<typeof schema.profileCreate>,
  ) {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { role: true, active: true },
      });
      if (user.role !== "SHAREHOLDER" || !user.active)
        throw new RecordError(409, "An active shareholder account is required");
      const { reason, ...data } = input;
      const after = await tx.shareholder.create({ data });
      await audit(
        tx,
        context,
        "PROFILE_CREATED",
        "shareholder",
        after.id,
        reason,
        null,
        after,
      );
      return after;
    });
  }
  async updateProfile(
    context: AuditContext,
    id: string,
    input: z.infer<typeof schema.profileUpdate>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shareholders WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.shareholder.findUniqueOrThrow({ where: { id } });
      const { reason, ...data } = input;
      const after = await tx.shareholder.update({ where: { id }, data });
      await audit(
        tx,
        context,
        "PROFILE_UPDATED",
        "shareholder",
        id,
        reason,
        before,
        after,
      );
      return after;
    });
  }
  async deleteProfile(context: AuditContext, id: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM shareholders WHERE id=${id}::uuid FOR UPDATE`;
      const before = await tx.shareholder.delete({ where: { id } });
      await audit(
        tx,
        context,
        "PROFILE_DELETED",
        "shareholder",
        id,
        reason,
        before,
        null,
      );
    });
  }
  private async lockRegister(
    tx: Prisma.TransactionClient,
    classId: string,
    shareholderId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM share_classes WHERE id=${classId}::uuid FOR UPDATE`;
    const cls = await tx.shareClass.findUniqueOrThrow({
      where: { id: classId },
    });
    await tx.$queryRaw`SELECT id FROM shareholders WHERE id=${shareholderId}::uuid FOR SHARE`;
    const holder = await tx.shareholder.findUniqueOrThrow({
      where: { id: shareholderId },
    });
    if (!holder.verifiedAt || !holder.verificationReference)
      throw new RecordError(
        409,
        "Verify the shareholder profile and record its source first",
      );
    return cls;
  }
  async open(context: AuditContext, input: z.infer<typeof schema.opening>) {
    return this.db.$transaction((tx) =>
      this.openInTransaction(tx, context, input),
    );
  }
  // CSV imports pass their existing transaction; never nest independent commits.
  async openInTransaction(
    tx: Prisma.TransactionClient,
    context: AuditContext,
    input: z.infer<typeof schema.opening>,
  ) {
    const cls = await this.lockRegister(
      tx,
      input.shareClassId,
      input.shareholderId,
    );
    const total = await tx.shareholding.aggregate({
      where: { shareClassId: cls.id },
      _sum: { quantity: true },
    });
    if ((total._sum.quantity ?? 0n) + input.quantity > cls.issuedShares)
      throw new RecordError(409, "Opening exceeds the recorded class total");
    const holding = await tx.shareholding.create({
      data: {
        shareholderId: input.shareholderId,
        shareClassId: input.shareClassId,
        quantity: 0n,
      },
    });
    await tx.holdingEvent.create({
      data: {
        ...context,
        holdingId: holding.id,
        sequence: 1,
        kind: "OPENING",
        beforeQuantity: 0n,
        delta: input.quantity,
        afterQuantity: input.quantity,
        reason: input.reason,
        sourceReference: input.sourceReference,
        verifiedAt: input.verifiedAt,
        effectiveAt: input.effectiveAt,
      },
    });
    return tx.shareholding.findUniqueOrThrow({ where: { id: holding.id } });
  }
  async adjust(
    context: AuditContext,
    id: string,
    input: z.infer<typeof schema.adjustment>,
  ) {
    return this.db.$transaction(async (tx) => {
      const original = await tx.shareholding.findUniqueOrThrow({
        where: { id },
      });
      const cls = await this.lockRegister(
        tx,
        original.shareClassId,
        original.shareholderId,
      );
      const holding = await tx.shareholding.findUniqueOrThrow({
        where: { id },
      });
      if (!holding.verifiedAt)
        throw new RecordError(
          409,
          "Verify the legacy opening balance before adjustments",
        );
      const quantity = holding.quantity + input.delta;
      if (quantity < 0n || quantity > MAX_SHARES)
        throw new RecordError(
          409,
          "Correction would produce an invalid share count",
        );
      const total = await tx.shareholding.aggregate({
        where: { shareClassId: cls.id },
        _sum: { quantity: true },
      });
      if ((total._sum.quantity ?? 0n) + input.delta > cls.issuedShares)
        throw new RecordError(
          409,
          "Correction exceeds the recorded class total",
        );
      const last = await tx.holdingEvent.findFirst({
        where: { holdingId: id },
        orderBy: { sequence: "desc" },
      });
      await tx.holdingEvent.create({
        data: {
          ...context,
          holdingId: id,
          sequence: (last?.sequence ?? 0) + 1,
          kind: "ADJUSTMENT",
          beforeQuantity: holding.quantity,
          delta: input.delta,
          afterQuantity: quantity,
          reason: input.reason,
          sourceReference: input.sourceReference,
          effectiveAt: input.effectiveAt,
        },
      });
      return tx.shareholding.findUniqueOrThrow({ where: { id } });
    });
  }
  async verify(
    context: AuditContext,
    id: string,
    input: z.infer<typeof schema.verification>,
  ) {
    return this.db.$transaction(async (tx) => {
      const original = await tx.shareholding.findUniqueOrThrow({
        where: { id },
      });
      await this.lockRegister(
        tx,
        original.shareClassId,
        original.shareholderId,
      );
      const holding = await tx.shareholding.findUniqueOrThrow({
        where: { id },
      });
      if (holding.verifiedAt)
        throw new RecordError(409, "Opening balance is already verified");
      const last = await tx.holdingEvent.findFirst({
        where: { holdingId: id },
        orderBy: { sequence: "desc" },
      });
      await tx.holdingEvent.create({
        data: {
          ...context,
          holdingId: id,
          sequence: (last?.sequence ?? 0) + 1,
          kind: "VERIFICATION",
          beforeQuantity: holding.quantity,
          delta: 0n,
          afterQuantity: holding.quantity,
          ...input,
        },
      });
      return tx.shareholding.findUniqueOrThrow({ where: { id } });
    });
  }
  async listHoldings(
    scope: { userId?: string; shareholderId?: string; shareClassId?: string },
    limit: number,
    offset: number,
  ) {
    return this.db.$transaction(
      async (tx) =>
        tx.shareholding.findMany({
          where: {
            shareholderId: scope.shareholderId,
            shareClassId: scope.shareClassId,
            ...(scope.userId
              ? {
                  shareholder: { userId: scope.userId },
                  verifiedAt: { not: null },
                }
              : {}),
          },
          include: { shareClass: { include: { company: true } } },
          take: limit,
          skip: offset,
          orderBy: { id: "asc" },
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async getHolding(id: string, userId?: string) {
    return this.db.$transaction(
      async (tx) =>
        tx.shareholding.findFirstOrThrow({
          where: {
            id,
            ...(userId
              ? { shareholder: { userId }, verifiedAt: { not: null } }
              : {}),
          },
          include: { shareClass: { include: { company: true } } },
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async reconcile(classId: string) {
    return this.db.$transaction(
      async (tx) => {
        const cls = await tx.shareClass.findUniqueOrThrow({
          where: { id: classId },
        });
        const total = await tx.shareholding.aggregate({
          where: { shareClassId: classId },
          _sum: { quantity: true },
        });
        const verified = await tx.shareholding.aggregate({
          where: { shareClassId: classId, verifiedAt: { not: null } },
          _sum: { quantity: true },
        });
        const ledger = await tx.holdingEvent.aggregate({
          where: { holding: { shareClassId: classId } },
          _sum: { delta: true },
        });
        const quantity = total._sum.quantity ?? 0n,
          verifiedQuantity = verified._sum.quantity ?? 0n,
          ledgerQuantity = ledger._sum.delta ?? 0n;
        return {
          shareClassId: classId,
          issuedShares: cls.issuedShares,
          recordedShares: quantity,
          verifiedShares: verifiedQuantity,
          unverifiedShares: quantity - verifiedQuantity,
          unrecordedShares: cls.issuedShares - quantity,
          ledgerShares: ledgerQuantity,
          reconciled: quantity === ledgerQuantity,
          recordedPercentage: ownershipPercentage(quantity, cls.issuedShares),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}

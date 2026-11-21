import { Prisma } from "@prisma/client";
export class RecordError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface AuditContext {
  actorId: string;
  requestId: string;
}
export function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
export async function audit(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await tx.auditLog.create({
    data: {
      ...context,
      action,
      targetType,
      targetId,
      reason,
      metadata: jsonSnapshot({ before, after }),
    },
  });
}
// Round half up to six percentage decimals, using only integer arithmetic.
export function ownershipPercentage(
  quantity: bigint,
  issuedShares: bigint,
): string | null {
  if (issuedShares === 0n) return null;
  const scale = 1000000n;
  const scaled = (quantity * 100n * scale + issuedShares / 2n) / issuedShares;
  return `${scaled / scale}.${(scaled % scale).toString().padStart(6, "0")}`;
}
export const MAX_SHARES = 9223372036854775807n;

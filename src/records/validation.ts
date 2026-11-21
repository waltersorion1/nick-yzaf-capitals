import { z } from "zod";
import { MAX_SHARES } from "./common.js";
export const id = z.string().uuid();
export const name = z.string().trim().min(1).max(200);
export const reason = z.string().trim().min(3).max(1000);
export const reference = z.string().trim().min(3).max(300);
export const date = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine(
    (value) => value.getTime() <= Date.now(),
    "Future dates are not allowed",
  );
// Strings avoid losing precision before validation; neither JSON numbers nor scientific notation are accepted.
export const shares = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .transform(BigInt)
  .refine((value) => value <= MAX_SHARES);
export const positiveShares = shares.refine((value) => value > 0n);
export const delta = z
  .string()
  .regex(/^-?[1-9][0-9]{0,18}$/)
  .transform(BigInt)
  .refine((value) => value >= -MAX_SHARES && value <= MAX_SHARES);
export const pagination = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const companyCreate = z.object({ name, reason }).strict();
export const companyUpdate = companyCreate;
export const classCreate = z
  .object({ companyId: id, name, issuedShares: shares, reason })
  .strict();
export const classUpdate = z
  .object({ name: name.optional(), issuedShares: shares.optional(), reason })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.issuedShares !== undefined,
  );
export const profileCreate = z
  .object({
    userId: id,
    legalName: name,
    verifiedAt: date.optional(),
    verificationReference: reference.optional(),
    reason,
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.verifiedAt) === Boolean(value.verificationReference),
    "Supply both verification date and reference",
  );
export const profileUpdate = z
  .object({
    legalName: name.optional(),
    verifiedAt: date.optional(),
    verificationReference: reference.optional(),
    reason,
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.verifiedAt) === Boolean(value.verificationReference),
  )
  .refine(
    (value) => value.legalName !== undefined || value.verifiedAt !== undefined,
  );
export const opening = z
  .object({
    shareholderId: id,
    shareClassId: id,
    quantity: positiveShares,
    verifiedAt: date,
    effectiveAt: date,
    sourceReference: reference,
    reason,
  })
  .strict();
export const adjustment = z
  .object({ delta, effectiveAt: date, sourceReference: reference, reason })
  .strict();
export const verification = z
  .object({
    verifiedAt: date,
    effectiveAt: date,
    sourceReference: reference,
    reason,
  })
  .strict();
export const deletion = z.object({ reason }).strict();

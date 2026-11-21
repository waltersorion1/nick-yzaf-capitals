import { z } from "zod";
import { id, reason, reference } from "../records/validation.js";
export const money = z.string().regex(/^(0|[1-9][0-9]{0,19})(\.[0-9]{1,8})?$/);
export const currency = z.enum(["NGN", "USD", "GBP", "EUR"]);
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      value <= new Date().toISOString().slice(0, 10) &&
      value >= "1900-01-01"
    );
  }, "Use a real nonfuture date from 1900 onwards")
  .transform((value) => new Date(value + "T00:00:00Z"));
export const announcement = z
  .object({
    companyId: id,
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(3).max(8000),
    datedAt: day,
    sourceReference: reference,
    reason,
  })
  .strict();
export const valuation = z
  .object({
    shareClassId: id,
    asOf: day,
    pricePerShare: money,
    currency,
    methodology: z.string().trim().min(10).max(4000),
    sourceReference: reference,
    reason,
  })
  .strict();
const amount = money.refine(
  (value) => /[1-9]/.test(value),
  "Amount must be positive",
);
export const dividend = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("DECLARED"),
      shareholderId: id,
      shareClassId: id,
      amount,
      currency,
      datedAt: day,
      reference,
      reason,
    })
    .strict(),
  z
    .object({
      status: z.literal("PAID"),
      declarationId: id,
      amount,
      datedAt: day,
      reference,
      reason,
    })
    .strict(),
]);
export const action = z.object({ reason }).strict();
export const kind = z.enum(["announcements", "valuations", "dividend-records"]);

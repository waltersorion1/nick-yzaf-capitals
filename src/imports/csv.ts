import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  id,
  positiveShares,
  shares,
  date,
  reference,
} from "../records/validation.js";
export const HEADERS = [
  "company_id",
  "share_class_id",
  "shareholder_id",
  "quantity",
  "verified_at",
  "effective_at",
  "source_reference",
  "class_issued_shares",
  "expected_class_recorded_shares",
];
export const MAX_BYTES = 131072,
  MAX_ROWS = 200;
export interface RowError {
  field: string;
  code: string;
  message: string;
}
export interface CsvRow {
  line: number;
  values: Record<string, string>;
  errors: RowError[];
}
const schema = z.object({
  company_id: id,
  share_class_id: id,
  shareholder_id: id,
  quantity: positiveShares,
  verified_at: date,
  effective_at: date,
  source_reference: reference,
  class_issued_shares: shares,
  expected_class_recorded_shares: shares,
});
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function contentHash(csv: string): string {
  return digest(
    "opening-import-v1\0" +
      csv
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        .trimEnd(),
  );
}
export function parseCsv(csv: string): {
  rows: CsvRow[];
  globalErrors: string[];
} {
  if (Buffer.byteLength(csv, "utf8") > MAX_BYTES)
    return {
      rows: [],
      globalErrors: ["CSV exceeds the 128 KiB limit. No rows can be imported."],
    };
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = z
      .array(
        z.object({
          record: z.array(z.string()),
          info: z.object({ lines: z.number() }),
        }),
      )
      .parse(
        parse(csv, {
          bom: true,
          info: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          max_record_size: 4096,
        }),
      );
  } catch {
    return {
      rows: [],
      globalErrors: [
        "Malformed CSV. Check quotes, separators and the 4096-character record limit.",
      ],
    };
  }
  const headers = records.shift()?.record;
  if (
    !headers ||
    headers.length !== HEADERS.length ||
    new Set(headers).size !== headers.length ||
    HEADERS.some((name) => !headers.includes(name))
  )
    return {
      rows: [],
      globalErrors: [
        "Header must contain exactly the documented nine columns, without duplicates.",
      ],
    };
  const globalErrors: string[] = [];
  if (!records.length) globalErrors.push("Provide at least one opening row.");
  if (records.length > MAX_ROWS)
    globalErrors.push(
      "CSV exceeds 200 rows. Split it into separately reconciled files; no rows were imported.",
    );
  const rows = records.slice(0, MAX_ROWS).map(({ record, info }) => {
    const values = Object.fromEntries(
      headers.map((name, i) => [name, record[i] ?? ""]),
    );
    for (const key of ["company_id", "share_class_id", "shareholder_id"])
      values[key] = values[key].toLowerCase();
    const errors: RowError[] = [];
    if (record.length !== headers.length)
      errors.push({
        field: "row",
        code: "COLUMN_COUNT",
        message: `Expected nine cells, received ${record.length}.`,
      });
    const parsed = schema.safeParse(values);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        errors.push({
          field: String(issue.path[0]),
          code: "INVALID_VALUE",
          message:
            "Missing or invalid value. Use valid IDs, exact whole shares, source evidence and nonfuture ISO timestamps.",
        });
    if (/[\r\n]/.test(values.source_reference))
      errors.push({
        field: "source_reference",
        code: "INVALID_REFERENCE",
        message: "Source reference must be on one line.",
      });
    return { line: info.lines, values, errors };
  });
  return { rows, globalErrors };
}

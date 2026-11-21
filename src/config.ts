import { readFileSync } from "node:fs";
import { z } from "zod";

// Compose secrets are files, not automatically populated environment variables.
export function readConfig(input: NodeJS.ProcessEnv = process.env) {
  const values = { ...input };
  for (const name of ["DATABASE_URL", "SESSION_SECRET"]) {
    if (values[name] && values[name + "_FILE"])
      throw new Error(`Use only ${name} or ${name}_FILE`);
    if (values[name + "_FILE"])
      values[name] = readFileSync(values[name + "_FILE"]!, "utf8").trim();
  }
  const config = z
    .object({
      DATABASE_URL: z
        .string()
        .url()
        .refine((value) =>
          ["postgresql:", "postgres:"].includes(new URL(value).protocol),
        ),
      SESSION_SECRET: z.string().min(32),
      APP_ORIGIN: z
        .string()
        .url()
        .refine(
          (value) => new URL(value).origin === value,
          "Use an exact origin without path, credentials or trailing slash",
        ),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    })
    .parse(values);
  if (
    config.NODE_ENV === "production" &&
    !config.APP_ORIGIN.startsWith("https://")
  )
    throw new Error("Production requires HTTPS");
  return config;
}

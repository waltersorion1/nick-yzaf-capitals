import { randomBytes } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] || ".local/pilot-secrets");
try {
  await access(directory);
  throw new Error(
    "Secret directory already exists; never overwrite or rotate automatically",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(directory, { recursive: true, mode: 0o700 });
const owner = randomBytes(32).toString("hex"),
  runtime = randomBytes(32).toString("hex"),
  backup = randomBytes(32).toString("hex");
const files = {
  db_owner_password: owner,
  owner_url: `postgresql://nycap_owner:${owner}@db:5432/nycap`,
  runtime_url: `postgresql://nycap_app:${runtime}@db:5432/nycap`,
  session_secret: randomBytes(48).toString("hex"),
  backup_password: backup,
  backup_recipient: "REPLACE_WITH_OWNER_OFF_HOST_AGE_PUBLIC_RECIPIENT\n",
  admin_password: randomBytes(24).toString("hex"),
  edge_policy: 'respond "Private pilot awaiting access policy" 503\n',
  "create-roles.sql": `CREATE ROLE nycap_app LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\nCREATE ROLE nycap_backup LOGIN PASSWORD '${backup}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;\n`,
};
for (const [name, value] of Object.entries(files))
  await writeFile(resolve(directory, name), value, {
    mode:
      name === "create-roles.sql"
        ? 0o600
        : ["edge_policy", "backup_recipient"].includes(name)
          ? 0o644
          : 0o444,
    flag: "wx",
  });
console.log(
  "New secrets created without printing values. Edge policy denies all traffic; age public recipient and approved access policy must be configured before launch.",
);

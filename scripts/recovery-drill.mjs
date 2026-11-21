import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

// Intentionally refuses normal/production sources and never restores over an existing DB.
const { RECOVERY_CONTAINER: container, TEST_DATABASE_URL: sourceUrl } =
  process.env;
if (!container || !/^nycap-verify-[a-f0-9-]+$/.test(container) || !sourceUrl)
  throw new Error("Use the disposable container created by verify:isolated");
const parsed = new URL(sourceUrl),
  database = parsed.pathname.slice(1),
  user = decodeURIComponent(parsed.username);
if (database !== "nycap_test")
  throw new Error("Restore drill source must be nycap_test");
const target = "nycap_restore_" + randomUUID().replaceAll("-", "");
const directory = resolve(".local/recovery", target);
await mkdir(directory, { recursive: true, mode: 0o700 });
function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error("Recovery Docker operation failed: " + result.stderr);
  return result.stdout;
}
const source = new pg.Client({ connectionString: sourceUrl });
const restoredUrl = new URL(sourceUrl);
restoredUrl.pathname = "/" + target;
const restored = new pg.Client({ connectionString: restoredUrl.href });
const started = Date.now();
const sha = (text) => createHash("sha256").update(text).digest("hex");
const quoted = (name) => '"' + name.replaceAll('"', '""') + '"';
async function fingerprint(client) {
  const tables = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'sessions' ORDER BY tablename",
    )
  ).rows;
  const result = {};
  for (const { tablename } of tables) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(t)::text AS row FROM public.${quoted(tablename)} t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    result[tablename] = {
      count: rows.length,
      sha256: sha(rows.map((r) => r.row).join("\n")),
    };
  }
  const definitions =
    await client.query(`SELECT 'trigger' kind, tgname name, pg_get_triggerdef(oid) definition FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace)
    UNION ALL SELECT 'constraint', conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
    UNION ALL SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL SELECT 'function', proname, prosrc FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY 1,2,3`);
  result.schemaGuards = {
    count: definitions.rows.length,
    sha256: sha(JSON.stringify(definitions.rows)),
  };
  return result;
}
let created = false;
try {
  await source.connect();
  const before = await fingerprint(source);
  for (const required of [
    "users",
    "shareholdings",
    "holding_events",
    "audit_logs",
    "valuation_snapshots",
    "dividend_records",
    "opening_import_batches",
  ])
    if (!before[required]?.count)
      throw new Error("Drill needs representative fictional data: " + required);
  docker([
    "exec",
    container,
    "pg_dump",
    "-U",
    user,
    "-d",
    database,
    "-Fc",
    "--no-owner",
    "--no-acl",
    "--exclude-table-data=public.sessions",
    "-f",
    "/tmp/recovery.dump",
  ]);
  if (JSON.stringify(before) !== JSON.stringify(await fingerprint(source)))
    throw new Error("Source changed during backup; quiesce writers and retry");
  docker([
    "cp",
    container + ":/tmp/recovery.dump",
    resolve(directory, "backup.dump"),
  ]);
  docker([
    "exec",
    container,
    "createdb",
    "-U",
    user,
    "--template=template0",
    target,
  ]);
  created = true;
  docker([
    "exec",
    container,
    "pg_restore",
    "-U",
    user,
    "-d",
    target,
    "--no-owner",
    "--no-acl",
    "--exit-on-error",
    "--single-transaction",
    "/tmp/recovery.dump",
  ]);
  await restored.connect();
  const after = await fingerprint(restored);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Restored data/schema fingerprint mismatch");
  if (
    Number(
      (await restored.query("SELECT count(*) FROM sessions")).rows[0].count,
    ) !== 0
  )
    throw new Error("Restored sessions must be empty");
  for (const table of ["audit_logs", "holding_events"]) {
    await restored.query("BEGIN");
    let rejected = false;
    try {
      await restored.query(
        `UPDATE ${quoted(table)} SET id=id WHERE id=(SELECT id FROM ${quoted(table)} LIMIT 1)`,
      );
    } catch {
      rejected = true;
    } finally {
      await restored.query("ROLLBACK");
    }
    if (!rejected)
      throw new Error("Restored immutability guard missing: " + table);
  }
  const drift =
    await restored.query(`SELECT h.id FROM shareholdings h LEFT JOIN LATERAL
    (SELECT COALESCE(SUM(delta),0) quantity FROM holding_events WHERE "holdingId"=h.id) e ON true WHERE h.quantity<>e.quantity`);
  if (drift.rowCount) throw new Error("Restored ledger/snapshot drift");
  const capacity = await restored.query(
    `SELECT c.id FROM share_classes c JOIN shareholdings h ON h."shareClassId"=c.id GROUP BY c.id HAVING SUM(h.quantity)>c."issuedShares"`,
  );
  if (capacity.rowCount) throw new Error("Restored class capacity mismatch");
  const archive = await readFile(resolve(directory, "backup.dump"));
  const report = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    postgres: (await restored.query("SHOW server_version")).rows[0]
      .server_version,
    source: "disposable fictional nycap_test",
    target,
    archiveBytes: archive.length,
    archiveSha256: sha(archive),
    tables: after,
    identicalDataAndGuards: true,
    sessionsRestored: 0,
    immutableGuardsTested: true,
    ledgerAndCapacityReconciled: true,
  };
  await writeFile(
    resolve(directory, "evidence.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  await writeFile(
    resolve(".local/recovery-latest.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  console.log(
    `Recovery drill PASSED: ${Object.keys(after).length - 1} tables identical, ${archive.length} archive bytes, ${report.elapsedMs}ms; private evidence in .local/recovery`,
  );
} finally {
  await Promise.allSettled([source.end(), restored.end()]);
  if (created) docker(["exec", container, "dropdb", "-U", user, target]);
}

import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const project = "nycap-smoke-" + randomUUID().slice(0, 8);
const directory = resolve(".local", project),
  secrets = resolve(directory, "secrets"),
  backups = resolve(directory, "backups");
await mkdir(backups, { recursive: true, mode: 0o700 });
const origin = "https://localhost:9447";
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  PILOT_HOST: "localhost",
  APP_ORIGIN: origin,
  ACME_EMAIL: "fictional-smoke@example.test",
  HTTP_BIND: "127.0.0.1:9087",
  HTTPS_BIND: "127.0.0.1:9447",
  SECRETS_DIRECTORY: secrets,
  BACKUP_DIRECTORY: backups,
  BOOTSTRAP_ADMIN_EMAIL: "fictional-owner@example.test",
};
function run(
  command,
  args,
  { input, capture = false, allowFailure = false } = {},
) {
  return new Promise((ok, fail) => {
    const child = spawn(command, args, {
      env,
      stdio: [
        input ? "pipe" : "ignore",
        capture ? "pipe" : "inherit",
        capture ? "pipe" : "inherit",
      ],
    });
    let stdout = "",
      stderr = "";
    if (capture) {
      child.stdout.on("data", (v) => {
        stdout += v;
      });
      child.stderr.on("data", (v) => {
        stderr += v;
      });
    }
    if (input) child.stdin.end(input);
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 || allowFailure
        ? ok({ stdout, stderr, code })
        : fail(new Error(`${command} failed (${code}): ${stderr}`)),
    );
  });
}
const compose = (args, options) =>
  run(
    "docker",
    ["compose", "-p", project, "-f", "deploy/compose.yaml", ...args],
    options,
  );
const sql = (text, database = "nycap") =>
  compose(
    [
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "nycap_owner",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: text, capture: true },
  );
const checks = [];
let browser;
async function check(name, action) {
  await action();
  checks.push(name);
  console.log("Production-like check PASSED: " + name);
}
try {
  await run(process.execPath, ["deploy/provision.mjs", secrets]);
  // Local test only: no public listeners and no changes to the production deny-all policy.
  await writeFile(resolve(secrets, "edge_policy"), "tls internal\n");
  await compose([
    "build",
    "--build-arg",
    "RELEASE_ID=smoke-initial",
    "app",
    "migrate",
    "backup",
  ]);
  const key = await compose(
    ["run", "--rm", "--no-deps", "--entrypoint", "age-keygen", "backup"],
    { capture: true },
  );
  const recipient = key.stdout.match(/age1[a-z0-9]+/)?.[0];
  assert(recipient, "age public recipient generated");
  await writeFile(resolve(directory, "backup-identity"), key.stdout, {
    mode: 0o600,
  });
  await writeFile(resolve(secrets, "backup_recipient"), recipient + "\n");
  await compose(["up", "-d", "--wait", "db"]);
  await compose(["run", "--rm", "migrate"]);
  await sql(
    (await readFile(resolve(secrets, "create-roles.sql"), "utf8")) +
      (await readFile("deploy/runtime-grants.sql", "utf8")),
  );
  await compose(["run", "--rm", "bootstrap"]);
  const repeat = await compose(["run", "--rm", "bootstrap"], {
    capture: true,
    allowFailure: true,
  });
  assert.notEqual(repeat.code, 0, "Owner cannot be bootstrapped twice");
  await compose(["up", "-d", "--wait", "app", "proxy"]);
  await compose([
    "cp",
    "proxy:/data/caddy/pki/authorities/local/root.crt",
    resolve(directory, "ca.crt"),
  ]);
  const ca = await readFile(resolve(directory, "ca.crt"));
  await check(
    "TLS chain verified against isolated Caddy CA; health readiness no-store",
    async () => {
      await new Promise((ok, fail) => {
        https
          .get(origin + "/health/ready", { ca }, (res) => {
            try {
              assert.equal(res.statusCode, 200);
              assert.equal(res.headers["cache-control"], "no-store");
              res.resume();
              ok();
            } catch (error) {
              fail(error);
            }
          })
          .on("error", fail);
      });
    },
  );
  await check(
    "runtime role cannot alter schema or rewrite audit evidence",
    async () => {
      const permissions = await sql(
        "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='nycap_app'; SELECT has_schema_privilege('nycap_app','public','CREATE'),has_table_privilege('nycap_app','audit_logs','UPDATE'),has_table_privilege('nycap_app','holding_events','TRUNCATE');",
      );
      assert.match(permissions.stdout, /nycap_app\|f\|f\|f/);
      assert.match(permissions.stdout, /f\|f\|f/);
    },
  );
  // Chromium worker script loading does not inherit context TLS exceptions.
  // This flag belongs only to the isolated internal-CA test, never the live-origin checklist.
  browser = await chromium.launch({ args: ["--ignore-certificate-errors"] });
  // Browser trust-store installation is manual; Node above validates the CA without bypassing TLS.
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
    serviceWorkers: "allow",
  });
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("Email address").fill(env.BOOTSTRAP_ADMIN_EMAIL);
  await page
    .getByLabel("Password", { exact: true })
    .fill((await readFile(resolve(secrets, "admin_password"), "utf8")).trim());
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("heading", { name: "Register overview" }).waitFor();
  async function api(path, body, method = "POST", target = page) {
    return target.evaluate(
      async ({ path, body, method }) => {
        const csrf = await (
          await fetch("/api/auth/csrf", { cache: "no-store" })
        ).json();
        const response = await fetch(path, {
          method,
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf.token,
          },
          body: JSON.stringify(body),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
        };
      },
      { path, body, method },
    );
  }
  await check(
    "Secure HttpOnly SameSite server sessions and CSRF enforcement",
    async () => {
      const cookie = (await context.cookies()).find(
        (c) => c.name === "nycap.sid",
      );
      assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax");
      assert.equal(
        (
          await page.request.post("/api/admin/companies", { data: {} })
        ).status(),
        403,
      );
    },
  );
  const reason = "FICTIONAL production-like smoke",
    evidence = {
      reason,
      verifiedAt: "2026-01-01T00:00:00Z",
      effectiveAt: "2026-01-01T00:00:00Z",
      sourceReference: "FICTIONAL-SIGNED-SOURCE",
    };
  const company = await api("/api/admin/companies", {
    name: "FICTIONAL HTTPS smoke",
    reason,
  });
  assert.equal(company.status, 201);
  const cls = await api("/api/admin/share-classes", {
    companyId: company.body.id,
    name: "Ordinary",
    issuedShares: "1000",
    reason,
  });
  assert.equal(cls.status, 201);
  const password = "FICTIONAL-smoke-only-password-123!",
    profiles = [],
    holdings = [];
  for (const [index, quantity] of ["100", "200", null].entries()) {
    const user = await api("/api/admin/users", {
      email: `fictional-smoke-${index}@example.test`,
      password,
    });
    assert.equal(user.status, 201);
    const profile = await api("/api/admin/shareholders", {
      userId: user.body.id,
      legalName: `FICTIONAL HTTPS ${index}`,
      verifiedAt: evidence.verifiedAt,
      verificationReference: evidence.sourceReference,
      reason,
    });
    assert.equal(profile.status, 201);
    profiles.push(profile.body);
    if (quantity) {
      const holding = await api("/api/admin/holdings/openings", {
        shareholderId: profile.body.id,
        shareClassId: cls.body.id,
        quantity,
        ...evidence,
      });
      assert.equal(holding.status, 201);
      holdings.push(holding.body);
    }
  }
  await check(
    "restricted runtime publishes dated valuation, announcement and separate dividend records",
    async () => {
      for (const [kind, body] of [
        [
          "valuations",
          {
            shareClassId: cls.body.id,
            asOf: "2026-01-01",
            pricePerShare: "2.50",
            currency: "NGN",
            methodology: "FICTIONAL source book value and limitations",
            sourceReference: evidence.sourceReference,
            reason,
          },
        ],
        [
          "announcements",
          {
            companyId: company.body.id,
            title: "FICTIONAL HTTPS update",
            body: "FICTIONAL private smoke announcement",
            datedAt: "2026-01-01",
            sourceReference: evidence.sourceReference,
            reason,
          },
        ],
      ]) {
        const record = await api(`/api/admin/${kind}`, body);
        assert.equal(record.status, 201);
        assert.equal(
          (
            await api(`/api/admin/${kind}/${record.body.id}/publish`, {
              reason,
            })
          ).status,
          200,
        );
      }
      const declaration = await api("/api/admin/dividend-records", {
        status: "DECLARED",
        shareholderId: profiles[0].id,
        shareClassId: cls.body.id,
        amount: "10.00",
        currency: "NGN",
        datedAt: "2026-01-01",
        reference: "FICTIONAL-HTTPS-DECLARATION",
        reason,
      });
      assert.equal(declaration.status, 201);
      assert.equal(
        (
          await api(
            `/api/admin/dividend-records/${declaration.body.id}/publish`,
            { reason },
          )
        ).status,
        200,
      );
      const paid = await api("/api/admin/dividend-records", {
        status: "PAID",
        declarationId: declaration.body.id,
        amount: "4.00",
        datedAt: "2026-01-02",
        reference: "FICTIONAL-HTTPS-PAID",
        reason,
      });
      assert.equal(paid.status, 201);
      assert.equal(
        (
          await api(`/api/admin/dividend-records/${paid.body.id}/publish`, {
            reason,
          })
        ).status,
        200,
      );
    },
  );
  await check(
    "restricted runtime commits and replays reviewed CSV with exact reconciliation",
    async () => {
      const csv =
        "company_id,share_class_id,shareholder_id,quantity,verified_at,effective_at,source_reference,class_issued_shares,expected_class_recorded_shares\n" +
        [
          company.body.id,
          cls.body.id,
          profiles[2].id,
          "25",
          evidence.verifiedAt,
          evidence.effectiveAt,
          "FICTIONAL-CSV-SOURCE",
          "1000",
          "325",
        ].join(",");
      const preview = await api("/api/admin/imports/preview", { csv, reason });
      assert.equal(preview.status, 201);
      const committed = await api(
        `/api/admin/imports/${preview.body.batchId}/commit`,
        { confirm: true },
      );
      assert.equal(committed.status, 200);
      const replay = await api(
        `/api/admin/imports/${preview.body.batchId}/commit`,
        { confirm: true },
      );
      assert.equal(replay.status, 200);
      const reconciled = await page.request.get(
        `/api/admin/share-classes/${cls.body.id}/reconciliation`,
      );
      assert.equal(reconciled.status(), 200);
      assert.equal(
        (
          await sql(
            `SELECT SUM(quantity) FROM shareholdings WHERE "shareClassId"='${cls.body.id}'`,
          )
        ).stdout.trim(),
        "325",
      );
    },
  );
  const memberContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: origin,
    serviceWorkers: "allow",
  });
  memberContext.setDefaultTimeout(30000);
  const member = await memberContext.newPage();
  await member.goto("/");
  await member
    .getByLabel("Email address")
    .fill("fictional-smoke-0@example.test");
  await member.getByLabel("Password", { exact: true }).fill(password);
  await member.getByRole("button", { name: "Sign in securely" }).click();
  await member
    .getByRole("heading", { name: "Ownership at a glance" })
    .waitFor();
  await check(
    "HTTPS horizontal isolation, admin denial, manifest and worker scope",
    async () => {
      assert.equal(
        (
          await member.request.get(`/api/me/holdings/${holdings[1].id}`)
        ).status(),
        404,
      );
      assert.equal(
        (await member.request.get("/api/admin/companies")).status(),
        403,
      );
      assert.equal(
        (await member.request.get("/api/me/holdings")).headers()[
          "cache-control"
        ],
        "no-store",
      );
      const manifest = await (
        await member.request.get("/manifest.webmanifest")
      ).json();
      assert.equal(manifest.start_url, "/");
      assert.equal(manifest.scope, "/");
      for (const icon of manifest.icons)
        assert.equal((await member.request.get(icon.src)).status(), 200);
      await member.waitForFunction(
        async () =>
          (await navigator.serviceWorker.getRegistration())?.active?.state ===
          "activated",
      );
      await member.reload();
      await member.waitForFunction(
        () => navigator.serviceWorker.controller !== null,
      );
      assert.equal(
        await member.evaluate(
          async () => (await navigator.serviceWorker.getRegistration()).scope,
        ),
        origin + "/",
      );
      const cdp = await memberContext.newCDPSession(member);
      await cdp.send("Page.enable");
      assert.deepEqual(
        (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors,
        [],
      );
    },
  );
  await check(
    "HTTPS offline shell and storage exclude private records",
    async () => {
      const storage = await member.evaluate(async () => {
        const urls = [];
        let text = "";
        for (const key of await caches.keys())
          for (const req of await (await caches.open(key)).keys()) {
            urls.push(req.url);
            text += await (await (await caches.open(key)).match(req)).text();
          }
        return {
          urls,
          text,
          persistent: localStorage.length + sessionStorage.length,
          databases: await indexedDB.databases(),
        };
      });
      assert(
        storage.urls.every(
          (url) =>
            /\/(assets|icons)\//.test(url) || url.endsWith("/offline.html"),
        ),
      );
      assert(!storage.text.includes("fictional-smoke-0@example.test"));
      assert(!storage.text.includes("FICTIONAL HTTPS"));
      assert.equal(storage.persistent, 0);
      assert.equal(storage.databases.length, 0);
      await memberContext.setOffline(true);
      await member.getByRole("heading", { name: "You are offline" }).waitFor();
      await member.reload();
      await member.getByRole("heading", { name: /offline/i }).waitFor();
      assert(!(await member.content()).includes("FICTIONAL HTTPS"));
      await memberContext.close();
    },
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Sign in to NyCap" }).waitFor();
  await page.waitForFunction(
    async () =>
      (await navigator.serviceWorker.getRegistration())?.active?.state ===
      "activated",
  );
  await page.reload();
  await page.getByLabel("Email address").fill("fictional-draft@example.test");
  await check(
    "real rebuilt production image worker update waits for explicit acceptance",
    async () => {
      await compose(["build", "--build-arg", "RELEASE_ID=smoke-update", "app"]);
      await compose(["up", "-d", "--wait", "app"]);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration()).update();
      });
      await page.getByRole("button", { name: "Update and reload" }).waitFor();
      assert.equal(
        await page.getByLabel("Email address").inputValue(),
        "fictional-draft@example.test",
      );
      await Promise.all([
        page.waitForEvent("load"),
        page.getByRole("button", { name: "Update and reload" }).click(),
      ]);
      await page.waitForFunction(
        () =>
          document.querySelector("#login") &&
          document.querySelector('input[name="email"]').value === "",
      );
      assert.equal((await page.request.get("/api/auth/me")).status(), 401);
    },
  );
  await browser.close();
  browser = null;
  await check(
    "age-encrypted backup decrypts and restores identical business data into a NEW database",
    async () => {
      await compose(["run", "--rm", "backup"]);
      const archive = (await readdir(backups)).find((name) =>
        name.endsWith(".dump.age"),
      );
      assert(archive);
      assert(
        (await readFile(resolve(backups, archive)))
          .subarray(0, 40)
          .toString()
          .startsWith("age-encryption.org/v1"),
      );
      await compose([
        "run",
        "--rm",
        "--no-deps",
        "-v",
        `${resolve(directory, "backup-identity")}:/run/backup-identity:ro`,
        "--entrypoint",
        "/bin/bash",
        "backup",
        "-c",
        `umask 077; age -d -i /run/backup-identity /backups/${archive} > /backups/restored.dump`,
      ]);
      await compose([
        "cp",
        resolve(backups, "restored.dump"),
        "db:/tmp/restored.dump",
      ]);
      await compose([
        "exec",
        "-T",
        "db",
        "createdb",
        "-U",
        "nycap_owner",
        "nycap_smoke_restore",
      ]);
      await compose([
        "exec",
        "-T",
        "db",
        "pg_restore",
        "-U",
        "nycap_owner",
        "-d",
        "nycap_smoke_restore",
        "--no-owner",
        "--no-acl",
        "--single-transaction",
        "--exit-on-error",
        "/tmp/restored.dump",
      ]);
      const tables = [
        "users",
        "shareholders",
        "companies",
        "share_classes",
        "shareholdings",
        "holding_events",
        "audit_logs",
        "opening_import_batches",
        "announcements",
        "valuation_snapshots",
        "dividend_records",
        "_prisma_migrations",
      ];
      for (const table of tables) {
        const query = `SELECT count(*),md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) FROM "${table}" t`;
        assert.equal(
          (await sql(query, "nycap_smoke_restore")).stdout,
          (await sql(query)).stdout,
          table,
        );
      }
      assert.equal(
        (
          await sql("SELECT count(*) FROM sessions", "nycap_smoke_restore")
        ).stdout.trim(),
        "0",
      );
      await unlink(resolve(backups, "restored.dump"));
      checks.push(
        "encrypted archive sha256 " +
          createHash("sha256")
            .update(await readFile(resolve(backups, archive)))
            .digest("hex"),
      );
    },
  );
  await writeFile(
    ".local/production-smoke-latest.json",
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        origin,
        scope:
          "loopback Docker production mode, internal TLS CA; NOT Hostinger or public ACME",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    "Production-like smoke PASSED; this is NOT a live-origin deployment or pilot sign-off.",
  );
} finally {
  if (browser) await browser.close();
  if (!/^nycap-smoke-[a-f0-9]{8}$/.test(project))
    throw new Error("Unsafe cleanup project");
  await compose(["down", "--volumes", "--remove-orphans"], { capture: true });
}

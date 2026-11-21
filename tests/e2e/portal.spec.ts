import { test, expect, type Page } from "@playwright/test";
const fixture = () => JSON.parse(process.env.E2E_FIXTURE!);
// Reuse only real server session cookies in worker memory. Do not weaken the production rate limit.
interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}
const sessions = new Map<string, SessionCookie[]>();
async function login(page: Page, role = "member") {
  const expected = page.getByRole("heading", {
    name: role === "admin" ? "Register overview" : "Ownership at a glance",
  });
  if (sessions.has(role)) await page.context().addCookies(sessions.get(role)!);
  await page.goto("/");
  await expect(
    expected.or(page.getByRole("heading", { name: "Sign in to NyCap" })),
  ).toBeVisible();
  if (await expected.isVisible()) return;
  await page.getByLabel("Email address").fill(fixture()[role]);
  await page.getByLabel("Password", { exact: true }).fill(fixture().password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(expected).toBeVisible();
  sessions.set(role, await page.context().cookies());
}
async function ready(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
test("navigation, real holdings isolation, company details and both themes", async ({
  page,
}) => {
  await login(page);
  await expect(page.getByText("10.000000%", { exact: true })).toBeVisible();
  await expect(
    page.getByText(fixture().company, { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("20.000000%", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: `test-results/portal-${test.info().project.name}.png`,
    fullPage: true,
  });
  const status = await page.evaluate(
    async (id) =>
      (await fetch("/api/me/holdings/" + id, { cache: "no-store" })).status,
    fixture().theirs,
  );
  expect(status).toBe(404);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My holdings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "My holdings" }),
  ).toBeVisible();
  await page.locator("tbody a").first().click();
  await expect(
    page.getByRole("heading", { name: fixture().company }),
  ).toBeVisible();
  await expect(page.getByText("Not available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Switch to/ }).click();
  const mode = await page.locator("html").getAttribute("data-bs-theme");
  await page.getByRole("button", { name: /Switch to/ }).click();
  expect(await page.locator("html").getAttribute("data-bs-theme")).not.toBe(
    mode,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("administrator sees real navigation and read-only register", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(
    page.getByRole("link", { name: "Register holdings", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Companies", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Company register" }),
  ).toBeVisible();
  await page.getByRole("heading", { name: fixture().company }).click();
  await expect(
    page.getByRole("heading", { name: fixture().company }),
  ).toBeVisible();
});
test("empty and failed requests show useful states and retry", async ({
  page,
}) => {
  await login(page, "empty");
  await expect(
    page.getByRole("heading", { name: "No holdings to display" }),
  ).toBeVisible();
  await page.route("**/api/me/holdings?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary test outage" }),
    }),
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My holdings" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Unable to load records" }),
  ).toBeVisible();
  await page.unroute("**/api/me/holdings?**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "No holdings to display" }),
  ).toBeVisible();
});
test("offline clears private DOM and offline relaunch is generic", async ({
  page,
  context,
}) => {
  await login(page);
  await ready(page);
  await expect(page.getByText("10.000000%", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  await expect(page.getByText(fixture().member, { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator("tbody")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: /offline/i })).toBeVisible();
  expect(await page.content()).not.toContain(fixture().company);
  await context.setOffline(false);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Ownership at a glance" }),
  ).toBeVisible();
});
test("cache and browser storage contain public assets only; logout expires session", async ({
  page,
}) => {
  await login(page);
  await ready(page);
  await expect(
    page.getByRole("heading", { name: "Ownership at a glance" }),
  ).toBeVisible();
  const storage = await page.evaluate(async () => {
    const entries = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys())
        entries.push(request.url);
    }
    return {
      entries,
      local: localStorage.length,
      session: sessionStorage.length,
      dbs: await indexedDB.databases(),
    };
  });
  const cachedText = await page.evaluate(async () => {
    let text = "";
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys())
        text += await (await cache.match(request))!.text();
    }
    return text;
  });
  expect(cachedText).not.toContain(fixture().member);
  expect(cachedText).not.toContain(fixture().company);
  expect(cachedText).not.toContain(fixture().password);
  expect(storage.local).toBe(0);
  expect(storage.session).toBe(0);
  expect(storage.dbs).toHaveLength(0);
  expect(storage.entries.length).toBeGreaterThan(0);
  expect(
    storage.entries.every(
      (url) => /\/(assets|icons)\//.test(url) || url.endsWith("/offline.html"),
    ),
  ).toBe(true);
  const response = await page.request.get("/api/me/holdings");
  expect(response.headers()["cache-control"]).toBe("no-store");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to NyCap" }),
  ).toBeVisible();
  expect((await page.request.get("/api/me/holdings")).status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to NyCap" }),
  ).toBeVisible();
});
test("manifest, icons and Chromium installability have no blocking errors", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeHidden();
  const manifest = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  expect(manifest.start_url).toBe("/");
  for (const size of [192, 512]) {
    const icon = await page.request.get(`/icons/icon-${size}.png`);
    expect(icon.ok()).toBe(true);
    const bytes = await icon.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const result = await cdp.send("Page.getInstallabilityErrors");
  expect(result.installabilityErrors).toEqual([]);
  await expect(page.getByText(/On iOS Safari/)).toBeHidden();
  await page.getByText("Install on your device", { exact: true }).click();
  await expect(page.getByText(/On iOS Safari/)).toBeVisible();
});
test("login failures are accessible and credentials are never retained", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email address").fill("missing@example.test");
  await page.getByLabel("Password", { exact: true }).fill("incorrect-password");
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});

test("real worker update waits for consent and preserves in-progress sign-in", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page.getByLabel("Email address").fill("draft@example.test");
  await page.request.post("/__e2e/worker-version");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveValue(
    "draft@example.test",
  );
  await page.getByRole("button", { name: "Update and reload" }).click();
  await expect(page.getByLabel("Email address")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Update and reload" }),
  ).toBeHidden();
  const keys = await page.evaluate(() => caches.keys());
  expect(keys.filter((key) => key.startsWith("nycap-public-"))).toHaveLength(1);
});

test("loading state is announced before records arrive", async ({ page }) => {
  await login(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/me/holdings?**", async (route) => {
    await pending;
    await route.continue();
  });
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "My holdings" })
    .click();
  await expect(
    page.getByRole("status", { name: "Loading records" }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "My holdings" }),
  ).toBeVisible();
});

test("published valuation chart, exact value and separate dividend totals stay private offline", async ({
  page,
  context,
}) => {
  await login(page, "reporter");
  await expect(page.getByText("NGN 13.00", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Companies", exact: false })
    .click();
  await page.getByRole("heading", { name: fixture().reportCompany }).click();
  await expect(
    page.getByRole("heading", { name: "Indicative valuation history" }),
  ).toBeVisible();
  await expect(
    page.getByText("Indicative only - not a live market quote.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("FICTIONAL private announcement body", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  const points = await page.evaluate(() => {
    const chart = (window as any).Chart.getChart(
      document.querySelector("canvas"),
    );
    return chart.data.datasets[0].data;
  });
  expect(points).toEqual([2.5, 3.25]);
  await expect(page.locator(".dividend-totals")).toContainText(
    "Declared: NGN 100.00",
  );
  await expect(page.locator(".dividend-totals")).toContainText(
    "Paid: NGN 40.00",
  );
  await expect(
    page.getByText("FICTIONAL draft not visible to readers"),
  ).toHaveCount(0);
  await page.screenshot({
    path: `test-results/reporting-${test.info().project.name}.png`,
    fullPage: true,
  });
  await ready(page);
  const stored = await page.evaluate(async () => {
    let body = "";
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys())
        body += await (await cache.match(request))!.text();
    }
    return {
      body,
      local: localStorage.length,
      session: sessionStorage.length,
      dbs: await indexedDB.databases(),
    };
  });
  expect(stored.body).not.toContain(fixture().reporter);
  expect(stored.body).not.toContain("FICTIONAL private announcement body");
  expect(stored.body).not.toContain("FICTIONAL-BROWSER-VALUE");
  expect(stored.local + stored.session).toBe(0);
  expect(stored.dbs).toHaveLength(0);
  await expect(page.locator("canvas")).toHaveCount(1);
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => Object.keys((window as any).Chart.instances).length,
    ),
  ).toBe(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.reload();
  expect(await page.content()).not.toContain(
    "FICTIONAL private announcement body",
  );
});
test("administrator saves, publishes and withdraws source records through the company UI", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/#company/" + fixture().reportCompanyId);
  await expect(
    page.getByRole("heading", { name: fixture().reportCompany }),
  ).toBeVisible();
  await page.getByText("Add company announcement", { exact: true }).click();
  const form = page.locator('[data-report-form="announcements"]');
  const title = "FICTIONAL browser publication " + test.info().project.name;
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form.getByLabel("Announcement date").fill("2026-01-01");
  await form
    .getByLabel("Announcement text")
    .fill("Fictional company announcement created through the UI.");
  await form
    .getByLabel("Source reference", { exact: true })
    .fill("FICTIONAL-UI-ANNOUNCEMENT");
  await form.getByLabel("Audit reason").fill("Fictional browser review");
  await form.getByRole("button", { name: "Save announcement draft" }).click();
  const record = page
    .locator(".announcement")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(record).toContainText("Draft");
  await page
    .getByLabel("Reason for publishing or withdrawing a record")
    .fill("Fictional publication source verified");
  await record.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(record).toContainText("Published");
  await page
    .getByText("Add indicative valuation snapshot", { exact: true })
    .click();
  const valueForm = page.locator('[data-report-form="valuations"]');
  const reference = "FICTIONAL-UI-VALUATION-" + test.info().project.name;
  await valueForm
    .getByRole("combobox", { name: "Share class", exact: true })
    .selectOption(fixture().reportClass);
  await valueForm
    .getByLabel("Valuation as-of date")
    .fill(test.info().project.name === "desktop" ? "2026-01-04" : "2026-01-05");
  await valueForm.getByLabel("Indicative price per share").fill("3.5");
  await valueForm
    .getByLabel("Methodology and limitations")
    .fill("FICTIONAL source book value with explanatory limitations.");
  await valueForm
    .getByLabel("Source reference", { exact: true })
    .fill(reference);
  await valueForm.getByLabel("Audit reason").fill("Fictional browser review");
  await valueForm.getByRole("button", { name: "Save valuation draft" }).click();
  const valuation = page.locator("tr").filter({ hasText: reference });
  await expect(valuation).toContainText("Draft");
  await page
    .getByLabel("Reason for publishing or withdrawing a record")
    .fill("Fictional valuation source verified");
  await valuation.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(valuation).toContainText("Published");
  await page
    .getByLabel("Reason for publishing or withdrawing a record")
    .fill("Fictional correction source superseded");
  await valuation
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await expect(valuation).toContainText("Withdrawn");
  await page.getByText("Add dividend record", { exact: true }).click();
  const dividendForm = page.locator('[data-report-form="dividend-records"]');
  const paymentReference = "FICTIONAL-UI-PAYMENT-" + test.info().project.name;
  await dividendForm
    .getByRole("combobox", { name: "Record type", exact: true })
    .selectOption("PAID");
  await dividendForm
    .getByRole("combobox", { name: "Published declaration", exact: true })
    .selectOption(fixture().reportDeclaration);
  await dividendForm.getByLabel("Source-record amount").fill("1.01");
  await dividendForm
    .getByLabel("Declaration or payment date")
    .fill("2026-01-02");
  await dividendForm
    .getByLabel("Declaration or payment reference")
    .fill(paymentReference);
  await dividendForm
    .getByLabel("Audit reason")
    .fill("Fictional payment record evidence");
  await dividendForm
    .getByRole("button", { name: "Save dividend draft" })
    .click();
  const paymentRow = page.locator("tr").filter({ hasText: paymentReference });
  await expect(paymentRow).toContainText("Draft");
  await page
    .getByLabel("Reason for publishing or withdrawing a record")
    .fill("Fictional payment reference verified");
  await paymentRow
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await expect(paymentRow).toContainText("Published");
  await expect(paymentRow).toContainText("PAID");
  await page
    .getByLabel("Reason for publishing or withdrawing a record")
    .fill("Fictional payment correction test");
  await paymentRow
    .getByRole("button", { name: "Withdraw", exact: true })
    .click();
  await expect(paymentRow).toContainText("Withdrawn");
});

test("admin workspace maintains companies, classes, invited profiles and audited holdings", async ({
  page,
}) => {
  await login(page, "admin");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Admin workspace", exact: false })
    .click();
  await expect(
    page.getByRole("heading", { name: "Maintain the source register" }),
  ).toBeVisible();
  const name =
      "FICTIONAL UI company " +
      test.info().project.name +
      " " +
      fixture().companyId.slice(0, 8),
    form = page.locator("#company-editor");
  await form.getByLabel("Company name").fill(name);
  await form.getByLabel("Audit reason").fill("Fictional register creation");
  await form.getByRole("button", { name: "Save company", exact: true }).click();
  const row = page
    .locator("tr")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Edit company", exact: true }).click();
  await form.getByLabel("Company name").fill(name + " corrected");
  await form.getByLabel("Audit reason").fill("Fictional name correction");
  await form.getByRole("button", { name: "Save company", exact: true }).click();
  const updated = page.locator("tr").filter({
    has: page.getByRole("link", { name: name + " corrected", exact: true }),
  });
  await expect(updated).toBeVisible();
  const classForm = page.locator("#class-editor");
  await classForm
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption({ label: name + " corrected" });
  await classForm.getByLabel("Share-class name").fill("Fictional unused class");
  await classForm.getByLabel("Registered issued shares").fill("1000");
  await classForm.getByLabel("Audit reason").fill("Fictional class source");
  await classForm
    .getByRole("button", { name: "Save share class", exact: true })
    .click();
  const classRow = page
    .locator("tr")
    .filter({ hasText: name + " corrected / Fictional unused class" });
  await expect(classRow).toBeVisible();
  await classRow
    .getByRole("button", { name: "Edit class", exact: true })
    .click();
  await classForm
    .getByLabel("Share-class name")
    .fill("Fictional corrected class");
  await classForm
    .getByLabel("Audit reason")
    .fill("Fictional class name source");
  await classForm
    .getByRole("button", { name: "Save share class", exact: true })
    .click();
  const changedClass = page
    .locator("tr")
    .filter({ hasText: name + " corrected / Fictional corrected class" });
  await expect(changedClass).toBeVisible();
  await changedClass
    .getByRole("button", { name: "Edit class", exact: true })
    .click();
  await classForm
    .getByLabel("Audit reason")
    .fill("Fictional unused class removal");
  await classForm
    .getByRole("button", { name: "Delete unused share class", exact: true })
    .click();
  await expect(changedClass).toHaveCount(0);
  await updated
    .getByRole("button", { name: "Edit company", exact: true })
    .click();
  await form
    .getByLabel("Audit reason")
    .fill("Fictional unused company removal");
  await form
    .getByRole("button", { name: "Delete unused company", exact: true })
    .click();
  await expect(updated).toHaveCount(0);
  await page.getByRole("button", { name: "Shareholders", exact: true }).click();
  const email = `ui-invite-${test.info().project.name}-${fixture().companyId}@example.test`,
    invite = page.locator("#invite-shareholder");
  await invite.getByLabel("Shareholder email").fill(email);
  await invite
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByLabel("Invitation token (deliver privately)"),
  ).toHaveValue(/^[a-f0-9]{64}$/);
  const profile = page.locator("#profile-editor");
  await profile
    .getByRole("combobox", { name: "Shareholder account", exact: true })
    .selectOption({ label: email });
  await profile
    .getByLabel("Legal name", { exact: true })
    .fill("FICTIONAL UI invited person");
  await profile
    .getByRole("checkbox", { name: "Source verification checked" })
    .check();
  await profile
    .getByLabel("Profile verification time (local)")
    .fill("2026-01-01T00:00");
  await profile
    .getByLabel("Profile verification reference")
    .fill("FICTIONAL-UI-LEGAL");
  await profile
    .getByLabel("Audit reason")
    .fill("Fictional legal source checked");
  await profile
    .getByRole("button", { name: "Save shareholder profile", exact: true })
    .click();
  const profileRow = page.locator("tr").filter({ hasText: email });
  await expect(profileRow).toContainText("Verified");
  await profileRow
    .getByRole("button", { name: "Edit profile", exact: true })
    .click();
  await profile
    .getByLabel("Legal name", { exact: true })
    .fill("FICTIONAL UI corrected person");
  await profile
    .getByLabel("Audit reason")
    .fill("Fictional legal name corrected");
  await profile
    .getByRole("button", { name: "Save shareholder profile", exact: true })
    .click();
  await expect(profileRow).toContainText("FICTIONAL UI corrected person");
  await profileRow
    .getByRole("button", { name: "Edit profile", exact: true })
    .click();
  await profile
    .getByLabel("Audit reason")
    .fill("Fictional unused profile removal");
  await profile
    .getByRole("button", { name: "Delete unused profile", exact: true })
    .click();
  await expect(profileRow).toHaveCount(0);
  await page
    .getByRole("button", { name: "Holdings & history", exact: true })
    .click();
  const f = fixture().csvFixtures[test.info().project.name],
    opening = page.locator("#opening-editor");
  await opening
    .getByRole("combobox", { name: "Shareholder", exact: true })
    .selectOption(f.profileId);
  await opening
    .getByRole("combobox", { name: "Share class", exact: true })
    .selectOption(f.editorClassId);
  await opening.getByLabel("Opening shares").fill("10");
  await opening
    .getByLabel("Opening verification time (local)")
    .fill("2026-01-01T00:00");
  await opening
    .getByLabel("Opening effective time (local)")
    .fill("2026-01-01T00:00");
  await opening
    .getByLabel("Opening source reference")
    .fill("FICTIONAL-MANUAL-OPENING");
  await opening
    .getByLabel("Audit reason")
    .fill("Fictional opening source verified");
  await opening
    .getByRole("button", { name: "Record verified opening", exact: true })
    .click();
  await expect(page.locator("#admin-message")).toContainText(
    "Opening recorded with an immutable event",
  );
  const response = await page.request.get(
      "/api/admin/holdings?shareClassId=" + f.editorClassId,
    ),
    holding = (await response.json())[0];
  await page
    .getByRole("combobox", { name: "Holding", exact: true })
    .selectOption(holding.id);
  const correction = page.locator("#correction-editor");
  await correction.getByLabel("Signed correction in shares").fill("1");
  await correction
    .getByLabel("Correction effective time (local)")
    .fill("2026-01-01T00:00");
  await correction
    .getByLabel("Correction source reference")
    .fill("FICTIONAL-UI-CORRECTION");
  await correction
    .getByLabel("Audit reason")
    .fill("Fictional correction proof");
  await correction
    .getByRole("button", { name: "Append correction", exact: true })
    .click();
  await expect(page.locator("#admin-message")).toContainText(
    "Holding event recorded and audited.",
  );
  await page
    .getByRole("combobox", { name: "Holding", exact: true })
    .selectOption(holding.id);
  await page
    .getByRole("button", { name: "View holding history", exact: true })
    .click();
  await expect(page.locator("#holding-history-result")).toContainText(
    "ADJUSTMENT",
  );
  await page
    .getByRole("button", { name: "Companies & classes", exact: true })
    .click();
  await page.locator(`[data-reconcile="${f.editorClassId}"]`).click();
  await expect(page.locator("#class-reconciliation")).toContainText(
    "Reconciled",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/admin-viewport-${test.info().project.name}.png`,
  });
  await page.getByRole("button", { name: "Reporting", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Announcements, valuations and dividends",
    }),
  ).toBeVisible();
});
test("CSV preview blocks bad rows, commits reviewed rows once and retains a private receipt", async ({
  page,
  context,
}) => {
  await login(page, "admin");
  await page.goto("/#admin");
  await expect(
    page.getByRole("heading", { name: "Maintain the source register" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "CSV import", exact: true }).click();
  const f = fixture().csvFixtures[test.info().project.name],
    headers =
      "company_id,share_class_id,shareholder_id,quantity,verified_at,effective_at,source_reference,class_issued_shares,expected_class_recorded_shares";
  const text = (qty: string) =>
    headers +
    "\n" +
    [
      f.companyId,
      f.classId,
      f.profileId,
      qty,
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
      "FICTIONAL-CSV-UI",
      1000,
      100,
    ].join(",") +
    "\n";
  const form = page.locator("#csv-preview");
  await form.getByLabel("Opening CSV file").setInputFiles({
    name: "fictional-invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text("-1")),
  });
  await form.getByLabel("Audit reason").fill("Fictional CSV source review");
  await form.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preview has errors" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commit reviewed import", exact: true }),
  ).toHaveCount(0);
  await form.getByLabel("Opening CSV file").setInputFiles({
    name: "fictional-valid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text("100")),
  });
  await form.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preview ready for review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Commit reviewed import", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "I checked the source register and class reconciliation totals.",
    })
    .check();
  await page
    .getByRole("button", { name: "Commit reviewed import", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Import committed", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#import-result")).toContainText(
    "1 opening rows committed",
  );
  await page
    .locator("#csv-preview")
    .getByLabel("Opening CSV file")
    .setInputFiles({
      name: "fictional-valid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text("100")),
    });
  await page
    .locator("#csv-preview")
    .getByLabel("Audit reason")
    .fill("Fictional repeated upload");
  await page.getByRole("button", { name: "Preview CSV", exact: true }).click();
  await expect(page.locator("#import-result")).toContainText(
    "existing receipt; no duplicate writes",
  );
  const response = await page.request.get(
    "/api/admin/holdings?shareClassId=" + f.classId,
  );
  expect(await response.json()).toHaveLength(1);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", {
      name: "Download validation report (JSON)",
      exact: true,
    })
    .click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "nycap-opening-validation.json",
  );
  await ready(page);
  await page.getByRole("button", { name: "CSV import", exact: true }).click();
  await page
    .getByRole("button", { name: "View import report", exact: true })
    .first()
    .click();
  await expect(page.locator("#import-result")).toBeVisible();
  const cacheText = await page.evaluate(async () => {
    let text = "";
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      for (const request of await cache.keys())
        text += await (await cache.match(request))!.text();
    }
    return text;
  });
  expect(cacheText).not.toContain(f.name);
  expect(cacheText).not.toContain(f.profileId);
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", { name: "You are offline" }),
  ).toBeVisible();
  await expect(page.locator("#import-result")).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";
const fixture = () => JSON.parse(process.env.E2E_FIXTURE!);
async function login(page: Page, role = "member") {
  await page.goto("/");
  await page.getByLabel("Email address").fill(fixture()[role]);
  await page.getByLabel("Password", { exact: true }).fill(fixture().password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(
    page.getByRole("heading", {
      name: role === "admin" ? "Register overview" : "Ownership at a glance",
    }),
  ).toBeVisible();
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

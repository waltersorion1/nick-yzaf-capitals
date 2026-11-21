import { loadAdmin, adminView, bindAdmin, disposeAdmin } from "./admin-v4.js";
import {
  loadReports,
  reportView,
  bindReports,
  disposeReporting,
  refreshChartTheme,
  portfolio,
  coverage,
} from "./reporting-v4.js";
import { api, list } from "./api-v4.js";
import {
  escape,
  card,
  table,
  empty,
  heading,
  login,
  classTable,
} from "./views-v4.js";
import { setupPwa } from "./pwa-v4.js";
const $ = (selector) => document.querySelector(selector),
  content = $("#content");
let user = null,
  controller = null,
  epoch = 0;
const themeMedia = matchMedia("(prefers-color-scheme: light)");
let chosenTheme = false;
function theme(light) {
  document.documentElement.dataset.bsTheme = light ? "light" : "dark";
  $("#theme").textContent = light ? "Dark mode" : "Light mode";
  $("#theme").setAttribute(
    "aria-label",
    `Switch to ${light ? "dark" : "light"} mode`,
  );
  document.querySelector('meta[name="theme-color"]').content = light
    ? "#F2F5FA"
    : "#0D1424";
  refreshChartTheme();
}
theme(themeMedia.matches);
$("#theme").onclick = () => {
  chosenTheme = true;
  theme(document.documentElement.dataset.bsTheme !== "light");
};
themeMedia.addEventListener("change", (e) => {
  if (!chosenTheme) theme(e.matches);
});
const channel =
  "BroadcastChannel" in window ? new BroadcastChannel("nycap-session") : null;
if (channel)
  channel.onmessage = (event) => {
    if (event.data === "LOGOUT") {
      clearPrivate();
      if (navigator.onLine) showLogin("Signed out in another tab.");
      else connection();
    }
  };
function clearPrivate() {
  disposeAdmin();
  disposeReporting();
  document.querySelectorAll("form").forEach((form) => form.reset());
  document.title = "NyCap | Shareholder portal";
  content.removeAttribute("aria-busy");
  epoch++;
  controller?.abort();
  user = null;
  content.replaceChildren();
  $("#navigation").replaceChildren();
  $("#logout").hidden = true;
  $("#location").textContent = "Shareholder portal";
}
function connection() {
  const online = navigator.onLine;
  $("#connection").textContent = online ? "Online" : "Offline";
  $("#connection").classList.toggle("offline", !online);
  if (!online) {
    clearPrivate();
    content.innerHTML = empty(
      "You are offline",
      "Private holdings and account details cannot be displayed or modified offline. Reconnect to continue.",
    );
  }
}
function navigation() {
  const admin = user.role === "ADMIN";
  $("#logout").hidden = false;
  $("#navigation").innerHTML = [
    ["overview", "Overview", "01"],
    ["holdings", admin ? "Register holdings" : "My holdings", "02"],
    ["companies", "Companies", "03"],
    ...(admin ? [["admin", "Admin workspace", "04"]] : []),
  ]
    .map(
      ([route, label, n]) =>
        `<a href="#${route}" ${location.hash === `#${route}` || (!location.hash && route === "overview") ? 'aria-current="page"' : ""}><span>${n}</span>${label}</a>`,
    )
    .join("");
  $("#location").textContent = admin
    ? "Administration / Register overview"
    : "Shareholder / Your portfolio";
}
async function render(options = {}) {
  disposeAdmin();
  disposeReporting();
  if (!user || !navigator.onLine) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal,
    stamp = ++epoch;
  navigation();
  content.setAttribute("aria-busy", "true");
  content.innerHTML =
    '<div class="skeleton" role="status" aria-label="Loading records"><div></div><div></div><div></div></div>';
  try {
    const admin = user.role === "ADMIN";
    const rows = await list(
      admin ? "/api/admin/holdings" : "/api/me/holdings",
      signal,
    );
    const companies = admin
      ? await list("/api/admin/companies", signal)
      : [
          ...new Map(
            rows.map((row) => [
              row.shareClass.company.id,
              row.shareClass.company,
            ]),
          ).values(),
        ];
    if (stamp !== epoch) return;
    const [route, id] = location.hash.slice(1).split("/");
    let html = "",
      reporting = null,
      reportClasses = null;
    const overviewSummary =
      !admin && (!route || route === "overview")
        ? await api("/api/me/valuation-summary", undefined, signal)
        : null;
    if (stamp !== epoch) return;
    let workspace = null;
    if (route === "admin") {
      if (!admin) {
        html = empty(
          "Administrator access required",
          "Choose a page from your navigation.",
        );
      } else {
        workspace = await loadAdmin(signal);
        if (stamp !== epoch) return;
        html = adminView(workspace, options);
      }
    } else if (route === "holdings") {
      html =
        heading(
          admin ? "SOURCE REGISTER" : "YOUR OWNERSHIP",
          admin ? "Register holdings" : "My holdings",
          "Share counts and percentages use the relevant share class, not a blended company total.",
        ) + `<section class="panel">${table(rows, admin)}</section>`;
    } else if (route === "companies") {
      html =
        heading(
          "THE COMPANIES",
          admin ? "Company register" : "Your companies",
          "Explore the companies represented in your verified records.",
        ) +
        (companies.length
          ? `<div class="company-grid">${companies.map((c, i) => `<a class="panel company-card" href="#company/${escape(c.id)}"><span class="company-avatar">${String(i + 1).padStart(2, "0")}</span><h2>${escape(c.name)}</h2><p>View company &amp; share classes</p><span class="accent">Explore company &#8594;</span></a>`).join("")}</div>`
          : empty(
              "No companies yet",
              "Companies will appear when verified records are available.",
            ));
    } else if (route === "company") {
      const company = companies.find((c) => c.id === id);
      if (!company)
        html = empty(
          "Company not available",
          "This company is not part of your accessible register.",
        );
      else {
        const owned = rows.filter((row) => row.shareClass.company.id === id);
        let classes = admin
          ? await list(
              `/api/admin/share-classes?companyId=${encodeURIComponent(id)}`,
              signal,
            )
          : [
              ...new Map(
                owned.map((row) => [row.shareClassId, row.shareClass]),
              ).values(),
            ];
        reporting = await loadReports(id, admin, owned, signal);
        reportClasses = classes;
        if (stamp !== epoch) return;
        html =
          heading(
            "COMPANY DETAILS",
            company.name,
            "Recorded ownership by share class. Indicative values are not live market quotes.",
            '<a class="quiet" href="#companies">All companies</a>',
          ) +
          `<div class="metrics">${card("Share classes", String(classes.length), "Classes visible to your account")}${card(admin ? "Published reporting" : "Indicative portfolio value", admin ? "Class-specific" : portfolio(reporting.summary), admin ? "See source snapshots below" : coverage(reporting.summary))}</div><section class="panel"><h2>${admin ? "Recorded" : "Your"} holdings</h2>${table(owned, admin)}</section>${classTable(classes)}${reportView(reporting, classes, admin)}`;
      }
    } else if (route && route !== "overview")
      html = empty("Page not found", "Choose a page from the navigation.");
    else {
      html =
        heading(
          admin ? "ADMINISTRATOR ACCESS" : "YOUR PORTFOLIO",
          admin ? "Register overview" : "Ownership at a glance",
          admin
            ? "A clear view of the records you maintain."
            : "Your verified ownership, in one private place.",
          `<span class="account-pill">${escape(user.email)}</span>`,
        ) +
        `<div class="metrics">${card(admin ? "Companies in register" : "Companies", String(companies.length), admin ? "Source register coverage" : "Represented in your holdings")}${card(admin ? "Holding records" : "Share-class positions", String(rows.length), admin ? "Including records awaiting verification" : "Verified records linked to your account")}${card(admin ? "Valuation reporting" : "Indicative portfolio value", admin ? "Company details" : portfolio(overviewSummary), admin ? "Dated class-specific source snapshots" : coverage(overviewSummary))}</div><section class="panel"><div class="section-heading"><div><p class="eyebrow">${admin ? "REGISTER SNAPSHOT" : "YOUR REGISTER"}</p><h2>${admin ? "Recorded holdings" : "Holdings summary"}</h2></div><a href="#holdings">View all holdings &#8594;</a></div>${table(rows.slice(0, 5), admin)}</section><div class="info-grid"><section class="panel disclosure"><span class="accent">Verified records</span><h2>Clarity starts with the source.</h2><p>${admin ? "Legacy balances marked verification required remain hidden from shareholders until checked against source records. Use Admin workspace for register editing, reconciliation and reviewed CSV opening imports." : "Only verified holdings are shown. If something looks incomplete, contact your administrator to review the source register."}</p></section><section class="panel disclosure"><span class="accent">A considered perspective</span><h2>Ownership is not a market quote.</h2><p>Published valuations are dated and explicitly indicative. No trading, transfers or payments take place here.</p></section></div>`;
    }
    if (stamp !== epoch) return;
    content.innerHTML = html;
    if (workspace)
      bindAdmin(
        workspace,
        options,
        render,
        () => stamp === epoch && !!user && user.role === "ADMIN",
      );
    if (reporting) bindReports(reporting, id, admin, render);
    document.title = `${content.querySelector("h1,h2")?.textContent || "Portal"} | NyCap`;
    $("#announcement").textContent = "Page loaded";
  } catch (error) {
    if (error.name === "AbortError" || stamp !== epoch) return;
    if (error.status === 401) {
      clearPrivate();
      showLogin("Your session expired. Please sign in again.");
    } else {
      content.innerHTML =
        empty("Unable to load records", error.message) +
        '<button class="primary" id="retry">Try again</button>';
      $("#retry").onclick = render;
    }
  } finally {
    if (stamp === epoch) content.removeAttribute("aria-busy");
  }
}
function showLogin(message = "") {
  content.removeAttribute("aria-busy");
  content.innerHTML = login();
  $("#form-message").textContent = message;
  document.title = "Sign in | NyCap";
  for (const formId of ["login", "invite"])
    $("#" + formId).onsubmit = async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      const stamp = epoch;
      try {
        const result = await api(
          formId === "login" ? "/api/auth/login" : "/api/auth/accept-invite",
          Object.fromEntries(new FormData(e.target)),
        );
        if (stamp !== epoch) return;
        e.target.reset();
        if (formId === "login") {
          user = result;
          location.hash = "overview";
          await render();
        } else
          $("#form-message").textContent = "Account activated. Sign in above.";
      } catch (error) {
        if (stamp === epoch) $("#form-message").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
}
async function resume() {
  clearPrivate();
  if (!navigator.onLine) {
    connection();
    return;
  }
  const stamp = epoch;
  content.innerHTML = '<p role="status">Checking your session...</p>';
  try {
    const identity = await api("/api/auth/me");
    if (stamp !== epoch) return;
    user = identity;
    await render();
  } catch (error) {
    if (stamp === epoch)
      showLogin(
        error.status === 401
          ? ""
          : "Unable to check your session. Check your connection and sign in.",
      );
  }
}
$("#logout").onclick = async () => {
  const button = $("#logout");
  button.disabled = true;
  try {
    await api("/api/auth/logout", {});
    channel?.postMessage("LOGOUT");
    clearPrivate();
    location.hash = "signin";
    showLogin("Signed out securely.");
  } catch (error) {
    $("#announcement").textContent = error.message;
    alert("Sign out could not be confirmed. Reconnect and try again.");
  } finally {
    button.disabled = false;
  }
};
addEventListener("hashchange", () => {
  if (user) render();
});
addEventListener("offline", connection);
addEventListener("online", () => {
  connection();
  resume();
});
addEventListener("pagehide", () => {
  clearPrivate();
  document.querySelectorAll("form").forEach((form) => form.reset());
});
addEventListener("pageshow", resume);
connection();
setupPwa();

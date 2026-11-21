import { api, list } from "./api-v4.js";
import { escape, empty } from "./views-v4.js";
let charts = [];
export function disposeReporting() {
  for (const chart of charts) chart.destroy();
  charts = [];
}
export function refreshChartTheme() {
  const style = getComputedStyle(document.documentElement);
  for (const chart of charts) {
    chart.options.scales.x.ticks.color = style.getPropertyValue("--muted");
    chart.options.scales.y.ticks.color = style.getPropertyValue("--muted");
    chart.options.scales.x.grid.color = style.getPropertyValue("--line");
    chart.options.scales.y.grid.color = style.getPropertyValue("--line");
    chart.update("none");
  }
}
export function money(value, currency) {
  if (value === null || value === undefined) return "Not available";
  const [whole, fraction = ""] = String(value).split(".");
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}
export function portfolio(summary) {
  if (!summary?.complete || summary.totals.length !== 1) return "Not available";
  return money(summary.totals[0].amount, summary.totals[0].currency);
}
export function coverage(summary) {
  return summary?.positionCount
    ? `${summary.positionCount - summary.missingCount} of ${summary.positionCount} positions valued. ${summary.totals.length > 1 ? "Currencies remain separate." : "Dated indicative snapshots only."}`
    : "No published valuation is available";
}
const active = (record) => record.publishedAt && !record.withdrawnAt;
const state = (record) =>
  record.withdrawnAt ? "Withdrawn" : record.publishedAt ? "Published" : "Draft";
const actions = (record, kind, admin) =>
  admin && !record.withdrawnAt
    ? `<div class="report-actions">${!record.publishedAt ? `<button type="button" data-report-kind="${kind}" data-report-id="${escape(record.id)}" data-report-action="publish">Publish</button>` : ""}<button type="button" class="quiet" data-report-kind="${kind}" data-report-id="${escape(record.id)}" data-report-action="withdraw">Withdraw</button></div>`
    : "";
export async function loadReports(companyId, admin, owned, signal) {
  const access =
    admin ||
    owned.some((row) => !row.verificationRequired && BigInt(row.quantity) > 0n);
  if (!access)
    return {
      announcements: [],
      valuations: [],
      dividends: [],
      totals: { totals: [] },
      summary: null,
      profiles: [],
      access: false,
    };
  const announcements = await list(
    admin
      ? `/api/admin/announcements?companyId=${companyId}`
      : `/api/companies/${companyId}/announcements`,
    signal,
  );
  const valuations = await list(
    admin
      ? `/api/admin/valuations?companyId=${companyId}`
      : `/api/companies/${companyId}/valuations`,
    signal,
  );
  const dividends = await list(
    admin
      ? `/api/admin/dividend-records?companyId=${companyId}`
      : `/api/me/dividends?companyId=${companyId}`,
    signal,
  );
  const totals = admin
    ? { totals: [] }
    : await api(
        `/api/me/dividend-totals?companyId=${companyId}`,
        undefined,
        signal,
      );
  const summary = admin
    ? null
    : await api(
        `/api/me/valuation-summary?companyId=${companyId}`,
        undefined,
        signal,
      );
  const profiles = admin ? await list("/api/admin/shareholders", signal) : [];
  return {
    announcements,
    valuations,
    dividends,
    totals,
    summary,
    profiles,
    access: true,
  };
}
function field(name, label, type = "text", extra = "") {
  return `<label for="report-${name}">${label}</label><input id="report-${name}" name="${name}" type="${type}" ${extra} required>`;
}
const explanation = () =>
  '<label>Audit reason<input name="reason" minlength="3" maxlength="1000" required></label>';
const currencies =
  "<option>NGN</option><option>USD</option><option>GBP</option><option>EUR</option>";
function forms(data, classes) {
  const options = classes
    .map(
      (cls) => `<option value="${escape(cls.id)}">${escape(cls.name)}</option>`,
    )
    .join("");
  return `<section class="panel reporting-editor"><p class="eyebrow">ADMINISTRATOR REPORTING</p><h2>Record a source, then publish</h2><p>These forms save drafts. Review the source before publishing. Recording a dividend never executes a payment.</p><p id="report-message" role="status" aria-live="polite"></p><label for="report-action-reason">Reason for publishing or withdrawing a record</label><input id="report-action-reason" minlength="3" maxlength="1000" placeholder="Explain the source check or correction"><details><summary>Add company announcement</summary><form data-report-form="announcements">${field("title", "Title", "text", 'maxlength="200"')}${field("datedAt", "Announcement date", "date")}<label>Announcement text<textarea name="body" minlength="3" maxlength="8000" required></textarea></label>${field("sourceReference", "Source reference", "text", 'maxlength="300"')}${explanation()}<button class="primary">Save announcement draft</button></form></details><details><summary>Add indicative valuation snapshot</summary><form data-report-form="valuations"><label>Share class<select name="shareClassId" required>${options}</select></label>${field("asOf", "Valuation as-of date", "date")}<label>Currency<select name="currency">${currencies}</select></label>${field("pricePerShare", "Indicative price per share", "text", 'inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,8})?" maxlength="29"')}<label>Methodology and limitations<textarea name="methodology" minlength="10" maxlength="4000" required></textarea></label>${field("valuationReference", "Source reference", "text", 'maxlength="300"')}${explanation()}<button class="primary">Save valuation draft</button></form></details><details><summary>Add dividend record</summary><form data-report-form="dividend-records"><label>Record type<select name="status"><option>DECLARED</option><option>PAID</option></select></label><div data-declaration-fields><label>Shareholder<select name="shareholderId" required>${data.profiles.map((profile) => `<option value="${escape(profile.id)}">${escape(profile.legalName)}</option>`).join("")}</select></label><label>Share class<select name="shareClassId" required>${options}</select></label><label>Currency<select name="currency">${currencies}</select></label></div><div data-payment-fields hidden><label>Published declaration<select name="declarationId" disabled required><option value="">Select a source declaration</option>${data.dividends
    .filter((row) => row.status === "DECLARED" && active(row))
    .map(
      (row) =>
        `<option value="${escape(row.id)}">${escape(row.reference)} - ${escape(money(row.amount, row.currency))}</option>`,
    )
    .join(
      "",
    )}</select></label></div>${field("amount", "Source-record amount", "text", 'inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,8})?" maxlength="29"')}${field("dividendDate", "Declaration or payment date", "date")}${field("dividendReference", "Declaration or payment reference", "text", 'maxlength="300"')}${explanation()}<button class="primary">Save dividend draft</button></form></details></section>`;
}
export function reportView(data, classes, admin) {
  const published = data.valuations.filter(active);
  const groups = new Map();
  for (const row of published) {
    const key = row.shareClassId + "/" + row.currency;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  data.chartGroups = [...groups.values()];
  return `${admin ? forms(data, classes) : ""}<section class="panel"><p class="eyebrow">COMPANY UPDATES</p><h2>Announcements</h2>${data.announcements.length ? data.announcements.map((row) => `<article class="announcement"><p class="eyebrow">${escape(row.datedAt.slice(0, 10))} ${admin ? " / " + state(row) : ""}</p><h3>${escape(row.title)}</h3><p class="source-text">${escape(row.body)}</p><small>Source: ${escape(row.sourceReference)}</small>${actions(row, "announcements", admin)}</article>`).join("") : "<p>No published announcements available.</p>"}</section><section class="panel"><p class="eyebrow">DATED SOURCE SNAPSHOTS</p><h2>Indicative valuation history</h2><p><strong>Indicative only - not a live market quote.</strong> Prices are source snapshots, not trading prices. Chart coordinates are approximate; the table contains exact values.</p>${data.chartGroups.map((group, index) => `<h3>${escape(group[0].shareClass.name)} / ${escape(group[0].currency)}</h3><div class="chart-container"><canvas id="valuation-chart-${index}" role="img" aria-label="Indicative ${escape(group[0].shareClass.name)} valuation history in ${escape(group[0].currency)}, not a live market quote"></canvas></div>`).join("")}${data.valuations.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Valuation source records"><table class="table"><caption class="sr-only">Exact dated indicative valuation snapshots</caption><thead><tr><th>As of</th><th>Class</th><th>Indicative per share</th><th>Methodology / source</th>${admin ? "<th>Status / actions</th>" : ""}</tr></thead><tbody>${data.valuations.map((row) => `<tr><td>${escape(row.asOf.slice(0, 10))}</td><td>${escape(row.shareClass.name)}</td><td>${escape(money(row.pricePerShare, row.currency))}</td><td class="methodology">${escape(row.methodology)}<br><small>${escape(row.sourceReference)}</small></td>${admin ? `<td>${state(row)}${actions(row, "valuations", true)}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : "<p>Not available. No published valuation or methodology has been provided.</p>"}</section><section class="panel"><p class="eyebrow">HISTORICAL RECORDS</p><h2>${admin ? "Dividend register" : "Your dividend history"}</h2><p>DECLARED and PAID are separate source records. This page does not execute payments or show a wallet or withdrawable balance.</p>${!admin ? `<div class="dividend-totals">${data.totals.totals.map((row) => `<article><h3>${escape(row.currency)}</h3><p>Declared: <strong>${escape(money(row.declared, row.currency))}</strong></p><p>Paid: <strong>${escape(money(row.paid, row.currency))}</strong></p><small>Published records only; no currency conversion.</small></article>`).join("")}</div>` : ""}${data.dividends.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Dividend source records"><table class="table"><caption class="sr-only">Dividend declarations and recorded payments</caption><thead><tr><th>Date</th><th>Class</th><th>Record type</th><th>Amount</th><th>Reference</th>${admin ? "<th>Status / actions</th>" : ""}</tr></thead><tbody>${data.dividends.map((row) => `<tr><td>${escape(row.datedAt.slice(0, 10))}</td><td>${escape(row.shareClass.name)}</td><td><span class="badge-status">${escape(row.status)}</span></td><td>${escape(money(row.amount, row.currency))}</td><td>${escape(row.reference)}</td>${admin ? `<td>${state(row)}${actions(row, "dividend-records", true)}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : "<p>No published dividend records available.</p>"}</section>`;
}
export function bindReports(data, companyId, admin, refresh) {
  disposeReporting();
  for (const [index, group] of data.chartGroups.entries()) {
    if (!globalThis.Chart) continue;
    const sorted = [...group].sort((a, b) => a.asOf.localeCompare(b.asOf));
    charts.push(
      new globalThis.Chart(
        document.querySelector("#valuation-chart-" + index),
        {
          type: "line",
          data: {
            labels: sorted.map((row) => row.asOf.slice(0, 10)),
            datasets: [
              {
                label: `${group[0].shareClass.name} / ${group[0].currency} (indicative)`,
                data: sorted.map((row) => Number(row.pricePerShare)),
                borderColor: "#1CC49A",
                backgroundColor: "#1CC49A",
                tension: 0,
                pointRadius: 4,
                fill: false,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (item) =>
                    money(
                      sorted[item.dataIndex].pricePerShare,
                      sorted[item.dataIndex].currency,
                    ),
                },
              },
            },
            scales: {
              x: { ticks: { maxRotation: 45 } },
              y: { beginAtZero: true },
            },
          },
        },
      ),
    );
  }
  refreshChartTheme();
  if (!admin) return;
  const dividendForm = document.querySelector(
    '[data-report-form="dividend-records"]',
  );
  dividendForm.elements.status.onchange = () => {
    const paid = dividendForm.elements.status.value === "PAID";
    for (const [selector, hide] of [
      ["[data-declaration-fields]", paid],
      ["[data-payment-fields]", !paid],
    ]) {
      const section = dividendForm.querySelector(selector);
      section.hidden = hide;
      section
        .querySelectorAll("input,select")
        .forEach((input) => (input.disabled = hide));
    }
  };
  const message = (text) => {
    const node = document.querySelector("#report-message");
    if (node) node.textContent = text;
  };
  for (const form of document.querySelectorAll("[data-report-form]"))
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("button");
      button.disabled = true;
      try {
        const payload = Object.fromEntries(new FormData(form));
        const kind = form.dataset.reportForm;
        if (kind === "announcements") payload.companyId = companyId;
        if (kind === "valuations") {
          payload.sourceReference = payload.valuationReference;
          delete payload.valuationReference;
        }
        if (kind === "dividend-records") {
          payload.datedAt = payload.dividendDate;
          payload.reference = payload.dividendReference;
          delete payload.dividendDate;
          delete payload.dividendReference;
        }
        await api("/api/admin/" + kind, payload);
        await refresh();
        message(
          "Draft saved. Review the source and use Publish to make it visible.",
        );
      } catch (error) {
        message(error.message);
      } finally {
        button.disabled = false;
      }
    };
  for (const button of document.querySelectorAll("[data-report-action]"))
    button.onclick = async () => {
      const reason = document.querySelector("#report-action-reason");
      if (reason.value.trim().length < 3) {
        message("Enter an audit reason before publishing or withdrawing.");
        reason.focus();
        return;
      }
      button.disabled = true;
      try {
        await api(
          `/api/admin/${button.dataset.reportKind}/${button.dataset.reportId}/${button.dataset.reportAction}`,
          { reason: reason.value },
        );
        await refresh();
        message("Reporting status updated and audited.");
      } catch (error) {
        message(error.message);
        button.disabled = false;
      }
    };
}

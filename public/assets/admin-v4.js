import { api, list } from "./api-v4.js";
import { escape, shares, heading, empty } from "./views-v4.js";
let dispose = null;
export function disposeAdmin() {
  dispose?.();
  dispose = null;
}
const esc = escape;
const input = (name, label, extra = "") =>
  `<label>${label}<input name="${name}" ${extra} required></label>`;
const auditReason = () =>
  input("reason", "Audit reason", 'minlength="3" maxlength="1000"');
const options = (items, label, selected = "") =>
  items
    .map(
      (item) =>
        `<option value="${esc(item.id)}" ${selected === item.id ? "selected" : ""}>${esc(label(item))}</option>`,
    )
    .join("");
const select = (name, label, items, text) =>
  `<label>${label}<select name="${name}" required><option value="">Select a record</option>${options(items, text)}</select></label>`;
const table = (caption, headers, body) =>
  `<div class="table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="table"><caption class="sr-only">${esc(caption)}</caption><thead><tr>${headers.map((item) => `<th scope="col">${esc(item)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">No records yet.</td></tr>`}</tbody></table></div>`;
export async function loadAdmin(signal) {
  const data = {};
  for (const [key, path] of [
    ["companies", "companies"],
    ["classes", "share-classes"],
    ["profiles", "shareholders"],
    ["users", "users"],
    ["holdings", "holdings"],
    ["announcements", "announcements"],
    ["valuations", "valuations"],
    ["dividends", "dividend-records"],
    ["imports", "imports"],
  ])
    data[key] = await list("/api/admin/" + path, signal);
  return data;
}
export function adminView(data, initial = {}) {
  const companyName = (id) =>
    data.companies.find((row) => row.id === id)?.name ?? "Unknown company";
  const className = (cls) => companyName(cls.companyId) + " / " + cls.name;
  const person = (id) =>
    data.profiles.find((row) => row.id === id)?.legalName ??
    "Unknown shareholder";
  const tabs = [
    ["companies", "Companies & classes"],
    ["shareholders", "Shareholders"],
    ["holdings", "Holdings & history"],
    ["imports", "CSV import"],
    ["reporting", "Reporting"],
  ];
  const active = tabs.some(([id]) => id === initial.tab)
    ? initial.tab
    : "companies";
  return (
    heading(
      "ADMINISTRATOR WORKSPACE",
      "Maintain the source register",
      "Every change requires an audit reason. Openings and corrections record verified existing ownership; they do not issue or transfer shares.",
    ) +
    `<p id="admin-message" role="status" aria-live="polite">${esc(initial.message ?? "")}</p><div class="admin-tabs" role="group" aria-label="Admin sections">${tabs.map(([id, label]) => `<button type="button" data-admin-tab="${id}" aria-pressed="${id === active}">${label}</button>`).join("")}<button type="button" id="admin-refresh" class="quiet">Refresh register</button></div>
 <section data-admin-pane="companies" ${active !== "companies" ? "hidden" : ""}><div class="admin-grid"><section class="panel"><h2>Company details</h2><form id="company-editor"><input name="id" type="hidden">${input("name", "Company name", 'maxlength="200"')}${auditReason()}<button class="primary">Save company</button><button type="button" data-reset="company-editor">New company</button><button type="button" data-delete="companies" data-form="company-editor">Delete unused company</button></form></section><section class="panel"><h2>Share-class register</h2><p>Issued totals come from the legal register. A correction here does not issue shares.</p><form id="class-editor"><input name="id" type="hidden">${select("companyId", "Company", data.companies, (row) => row.name)}${input("name", "Share-class name", 'maxlength="200"')}${input("issuedShares", "Registered issued shares", 'inputmode="numeric" pattern="[0-9]+" maxlength="19"')}${auditReason()}<button class="primary">Save share class</button><button type="button" data-reset="class-editor">New share class</button><button type="button" data-delete="share-classes" data-form="class-editor">Delete unused share class</button></form></section></div><section class="panel"><h2>Companies</h2>${table("Companies", ["Company", "Actions"], data.companies.map((row) => `<tr><td><a href="#company/${esc(row.id)}">${esc(row.name)}</a></td><td><button type="button" data-edit-company="${esc(row.id)}">Edit company</button></td></tr>`).join(""))}</section><section class="panel"><h2>Classes and reconciliation</h2>${table("Share classes", ["Company / class", "Issued shares", "Actions"], data.classes.map((row) => `<tr><td>${esc(className(row))}</td><td>${shares(row.issuedShares)}</td><td><button type="button" data-edit-class="${esc(row.id)}">Edit class</button> <button type="button" data-reconcile="${esc(row.id)}">Reconcile</button></td></tr>`).join(""))}<div id="class-reconciliation" role="status"></div></section></section>
 <section data-admin-pane="shareholders" ${active !== "shareholders" ? "hidden" : ""}><div class="admin-grid"><section class="panel"><h2>Invite a shareholder</h2><p>Deliver the one-time token privately. This app does not send email.</p><form id="invite-shareholder">${input("email", "Shareholder email", 'type="email" autocomplete="off" maxlength="254"')}<button class="primary">Create invitation</button></form><div id="invitation-result">${initial.invitation ? `<label>Invitation token (deliver privately)<input readonly value="${esc(initial.invitation)}"></label>` : ""}</div></section><section class="panel"><h2>Shareholder profile</h2><form id="profile-editor"><input name="id" type="hidden">${select(
   "userId",
   "Shareholder account",
   data.users.filter((row) => row.role === "SHAREHOLDER" && row.active),
   (row) => row.email,
 )}${input("legalName", "Legal name", 'maxlength="200"')}<label class="check-label"><input name="verified" type="checkbox"> Source verification checked</label><div data-profile-evidence hidden>${input("verifiedAt", "Profile verification time (local)", 'type="datetime-local" step="0.001" disabled')}${input("verificationReference", "Profile verification reference", 'maxlength="300" disabled')}</div>${auditReason()}<button class="primary">Save shareholder profile</button><button type="button" data-reset="profile-editor">New profile</button><button type="button" data-delete="shareholders" data-form="profile-editor">Delete unused profile</button></form></section></div><section class="panel"><h2>Shareholder profiles</h2>${table("Shareholder profiles", ["Legal name", "Account", "Verification", "Action"], data.profiles.map((row) => `<tr><td>${esc(row.legalName)}</td><td>${esc(data.users.find((user) => user.id === row.userId)?.email ?? "Account not available")}</td><td>${row.verifiedAt && row.verificationReference ? "Verified" : "Verification required"}</td><td><button type="button" data-edit-profile="${esc(row.id)}">Edit profile</button></td></tr>`).join(""))}</section></section>
 <section data-admin-pane="holdings" ${active !== "holdings" ? "hidden" : ""}><section class="panel"><h2>Verified opening balance</h2><p>Use this only for an existing legal holding that has no register row yet. Existing rows, including zero balances, require corrections.</p><form id="opening-editor">${select("shareholderId", "Shareholder", data.profiles, (row) => row.legalName)}${select("shareClassId", "Share class", data.classes, className)}${input("quantity", "Opening shares", 'inputmode="numeric" pattern="[1-9][0-9]*" maxlength="19"')}${input("verifiedAt", "Opening verification time (local)", 'type="datetime-local" step="0.001"')}${input("effectiveAt", "Opening effective time (local)", 'type="datetime-local" step="0.001"')}${input("sourceReference", "Opening source reference", 'maxlength="300"')}${auditReason()}<button class="primary">Record verified opening</button></form></section><section class="panel"><h2>Correct or verify an existing holding</h2><label>Holding<select id="holding-choice"><option value="">Select a holding</option>${options(data.holdings, (row) => `${person(row.shareholderId)} / ${row.shareClass.company.name} / ${row.shareClass.name} / ${shares(row.quantity)} shares`)}</select></label><p id="holding-status"></p><form id="correction-editor">${input("delta", "Signed correction in shares", 'inputmode="text" pattern="-?[1-9][0-9]*" maxlength="20"')}${input("effectiveAt", "Correction effective time (local)", 'type="datetime-local" step="0.001"')}${input("sourceReference", "Correction source reference", 'maxlength="300"')}${auditReason()}<button class="primary">Append correction</button></form><form id="legacy-editor" hidden><h3>Verify preserved opening</h3><p>Check the old balance against its source. Verification preserves its quantity.</p>${input("verifiedAt", "Legacy verification time (local)", 'type="datetime-local" step="0.001"')}${input("effectiveAt", "Legacy effective time (local)", 'type="datetime-local" step="0.001"')}${input("sourceReference", "Legacy source reference", 'maxlength="300"')}${auditReason()}<button class="primary">Verify preserved opening</button></form><button type="button" id="holding-history">View holding history</button><div id="holding-history-result"></div></section></section>
 <section data-admin-pane="imports" ${active !== "imports" ? "hidden" : ""}><section class="panel"><h2>Import verified opening balances</h2><p>Step 1: preview and reconcile. Step 2: confirm the reviewed batch. A bad row rejects the whole file. No accounts or holdings are overwritten.</p><a class="quiet" href="/api/admin/imports/template">Download CSV template</a><form id="csv-preview"><label>Opening CSV file<input name="file" type="file" accept=".csv,text/csv" required></label>${auditReason()}<button class="primary">Preview CSV</button></form><p>UTF-8 CSV, up to 128 KiB and 200 rows. ISO timestamps must include a timezone. Expected class recorded totals include existing register balances plus every row of this file.</p><div id="import-result"></div></section><details class="panel"><summary>CSV identifiers and mappings</summary><p>These IDs are required by the CSV template. Match them to the source register; do not guess a company or class from its name alone.</p>${table("CSV class identifiers", ["Company", "Company ID", "Class", "Class ID", "Issued shares"], data.classes.map((row) => `<tr><td>${esc(companyName(row.companyId))}</td><td><code>${esc(row.companyId)}</code></td><td>${esc(row.name)}</td><td><code>${esc(row.id)}</code></td><td>${shares(row.issuedShares)}</td></tr>`).join(""))}${table("CSV shareholder identifiers", ["Shareholder", "Profile ID", "Verification"], data.profiles.map((row) => `<tr><td>${esc(row.legalName)}</td><td><code>${esc(row.id)}</code></td><td>${row.verifiedAt && row.verificationReference ? "Verified" : "Verification required"}</td></tr>`).join(""))}</details><section class="panel"><h2>My import history</h2>${table("Import history", ["Created", "State", "Action"], data.imports.map((row) => `<tr><td>${esc(new Date(row.createdAt).toLocaleString())}</td><td>${row.committedAt ? "Committed" : new Date(row.expiresAt) < new Date() ? "Expired preview" : "Preview"}</td><td><button type="button" data-import-view="${esc(row.id)}">View import report</button></td></tr>`).join(""))}</section></section>
 <section data-admin-pane="reporting" ${active !== "reporting" ? "hidden" : ""}><section class="panel"><h2>Announcements, valuations and dividends</h2><p>Open a company's reporting editor to save a draft, review its source, publish it or withdraw an incorrect record. Source values are immutable; use audited replacements rather than editing published history.</p>${table(
   "Company reporting",
   ["Company", "Source records", "Action"],
   data.companies
     .map((company) => {
       const rows = [
         ...data.announcements.filter((row) => row.companyId === company.id),
         ...data.valuations.filter(
           (row) =>
             data.classes.find((cls) => cls.id === row.shareClassId)
               ?.companyId === company.id,
         ),
         ...data.dividends.filter(
           (row) => row.shareClass.companyId === company.id,
         ),
       ];
       return `<tr><td>${esc(company.name)}</td><td>${rows.filter((row) => row.publishedAt && !row.withdrawnAt).length} published / ${rows.filter((row) => !row.publishedAt && !row.withdrawnAt).length} drafts / ${rows.filter((row) => row.withdrawnAt).length} withdrawn</td><td><a href="#company/${esc(company.id)}">Open reporting</a></td></tr>`;
     })
     .join(""),
 )}</section></section>`
  );
}
function importReport(batch) {
  const report = batch.report,
    receipt = batch.receipt,
    expired = !receipt && new Date(batch.expiresAt).getTime() <= Date.now();
  return `<div class="import-report"><h3>${receipt ? "Import committed" : expired ? "Preview expired" : report.canCommit ? "Preview ready for review" : "Preview has errors"}</h3><p>${receipt ? `${receipt.rowCount} opening rows committed${batch.replayed ? " (existing receipt; no duplicate writes)" : ""}.` : `${report.rows.length} rows checked. No holdings have been written.`}</p><p>Batch reference: <code>${esc(batch.batchId)}</code></p>${receipt ? "" : `<p>Preview expires: ${esc(new Date(batch.expiresAt).toLocaleString())}</p>`}${report.globalErrors.map((error) => `<p class="validation-error">${esc(error)}</p>`).join("")}${table("Import class reconciliation", ["Company / class", "Issued", "Before", "File shares", "After", "Source expected", "Unrecorded after", "Result"], report.reconciliations.map((row) => `<tr><td>${esc(row.companyName + " / " + row.shareClassName)}</td><td>${shares(row.issuedShares)}</td><td>${shares(row.recordedBefore)}</td><td>${shares(row.importShares)}</td><td>${shares(row.recordedAfter)}</td><td>${shares(row.expectedRecorded)}</td><td>${shares(row.unrecordedAfter)}</td><td>${row.errors.length ? esc(row.errors.join(" ")) : "Reconciled"}</td></tr>`).join(""))}${table("CSV row validation", ["CSV line", "Company / class", "Shareholder", "Shares", "Result"], report.rows.map((row) => `<tr><td>${row.line}</td><td>${esc((row.companyName ?? row.values.company_id) + " / " + (row.shareClassName ?? row.values.share_class_id))}</td><td>${esc(row.shareholderName ?? row.values.shareholder_id)}</td><td>${esc(row.values.quantity)}</td><td>${row.errors.length ? row.errors.map((error) => `${esc(error.field)}: ${esc(error.message)}`).join("<br>") : "Valid"}</td></tr>`).join(""))}<button type="button" id="download-import-report">Download validation report (JSON)</button>${!receipt && !expired && report.canCommit ? '<label class="check-label"><input id="import-confirm" type="checkbox"> I checked the source register and class reconciliation totals.</label><button type="button" class="primary" id="commit-import" disabled>Commit reviewed import</button>' : ""}</div>`;
}
export function bindAdmin(data, initial, refresh, isCurrent) {
  let batch = initial.receipt ?? null;
  dispose = () => {
    batch = null;
    data = null;
  };
  const status = (text) => {
    if (isCurrent())
      document.querySelector("#admin-message").textContent = text;
  };
  const showTab = (id) => {
    document
      .querySelectorAll("[data-admin-pane]")
      .forEach((node) => (node.hidden = node.dataset.adminPane !== id));
    document
      .querySelectorAll("[data-admin-tab]")
      .forEach((node) =>
        node.setAttribute("aria-pressed", String(node.dataset.adminTab === id)),
      );
  };
  for (const button of document.querySelectorAll("[data-admin-tab]"))
    button.onclick = () => showTab(button.dataset.adminTab);
  document.querySelector("#admin-refresh").onclick = () =>
    refresh({
      tab: document.querySelector('[data-admin-tab][aria-pressed="true"]')
        .dataset.adminTab,
    });
  const formValue = (form) => Object.fromEntries(new FormData(form));
  const localTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 23);
  };
  const run = async (button, action, tab, message) => {
    button.disabled = true;
    status("Saving register change...");
    try {
      const result = await action();
      if (isCurrent())
        await refresh({
          tab,
          message,
          holdingId: tab === "holdings" ? result?.id : undefined,
        });
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  };
  for (const [formId, path] of [
    ["company-editor", "companies"],
    ["class-editor", "share-classes"],
    ["profile-editor", "shareholders"],
  ]) {
    const form = document.getElementById(formId);
    form.onsubmit = (event) => {
      event.preventDefault();
      const payload = formValue(form),
        id = payload.id;
      delete payload.id;
      if (formId === "profile-editor") {
        const verified = form.elements.verified.checked;
        delete payload.verified;
        if (verified)
          payload.verifiedAt = new Date(payload.verifiedAt).toISOString();
        else {
          delete payload.verifiedAt;
          delete payload.verificationReference;
        }
      }
      if (id) {
        delete payload.companyId;
        delete payload.userId;
      }
      run(
        form.querySelector("button"),
        () =>
          api(
            "/api/admin/" + path + (id ? "/" + id : ""),
            payload,
            undefined,
            id ? "PATCH" : "POST",
          ),
        formId === "profile-editor" ? "shareholders" : "companies",
        "Register record saved and audited.",
      );
    };
  }
  for (const button of document.querySelectorAll("[data-reset]"))
    button.onclick = () => {
      const form = document.getElementById(button.dataset.reset);
      form.reset();
      form.elements.id.value = "";
      form
        .querySelectorAll("select")
        .forEach((node) => (node.disabled = false));
      if (form.id === "profile-editor") {
        form.elements.verified.disabled = false;
        form.elements.verified.dispatchEvent(new Event("change"));
      }
    };
  const edit = (form, record) => {
    form.reset();
    for (const [key, value] of Object.entries(record)) {
      if (
        form.elements.namedItem(key) &&
        value !== null &&
        typeof value !== "object"
      )
        form.elements.namedItem(key).value = String(value);
    }
    form.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  for (const button of document.querySelectorAll("[data-edit-company]"))
    button.onclick = () =>
      edit(
        document.querySelector("#company-editor"),
        data.companies.find((row) => row.id === button.dataset.editCompany),
      );
  for (const button of document.querySelectorAll("[data-edit-class]"))
    button.onclick = () => {
      const form = document.querySelector("#class-editor");
      edit(
        form,
        data.classes.find((row) => row.id === button.dataset.editClass),
      );
      form.elements.companyId.disabled = true;
    };
  const profileForm = document.querySelector("#profile-editor");
  profileForm.elements.verified.onchange = () => {
    const enabled = profileForm.elements.verified.checked;
    profileForm.querySelector("[data-profile-evidence]").hidden = !enabled;
    for (const name of ["verifiedAt", "verificationReference"])
      profileForm.elements[name].disabled = !enabled;
  };
  for (const button of document.querySelectorAll("[data-edit-profile]"))
    button.onclick = () => {
      const form = profileForm,
        record = data.profiles.find(
          (row) => row.id === button.dataset.editProfile,
        );
      edit(form, record);
      form.elements.userId.disabled = true;
      form.elements.verified.checked = !!record.verifiedAt;
      form.elements.verified.disabled = !!(
        record.verifiedAt && record.verificationReference
      );
      form.elements.verified.dispatchEvent(new Event("change"));
      form.elements.verifiedAt.value = localTime(record.verifiedAt);
    };
  for (const button of document.querySelectorAll("[data-delete]"))
    button.onclick = () => {
      const form = document.getElementById(button.dataset.form),
        id = form.elements.id.value,
        reason = form.elements.reason.value.trim();
      if (!id || reason.length < 3) {
        status(
          "Select an existing record with Edit and enter an audit reason before deleting an unused record.",
        );
        return;
      }
      run(
        button,
        () =>
          api(
            `/api/admin/${button.dataset.delete}/${id}`,
            { reason },
            undefined,
            "DELETE",
          ),
        button.dataset.delete === "shareholders" ? "shareholders" : "companies",
        "Unused record deleted and audited. Referenced records cannot be deleted.",
      );
    };
  const invitation = document.querySelector("#invite-shareholder");
  invitation.onsubmit = async (event) => {
    event.preventDefault();
    const button = invitation.querySelector("button");
    button.disabled = true;
    try {
      const result = await api("/api/admin/users", {
        email: invitation.elements.email.value,
        role: "SHAREHOLDER",
      });
      if (isCurrent())
        await refresh({
          tab: "shareholders",
          invitation: result.invitationToken,
          message:
            "Invitation created. Deliver its token privately; it is shown only in this view.",
        });
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  };
  for (const button of document.querySelectorAll("[data-reconcile]"))
    button.onclick = async () => {
      button.disabled = true;
      try {
        const row = await api(
          `/api/admin/share-classes/${button.dataset.reconcile}/reconciliation`,
        );
        if (isCurrent())
          document.querySelector("#class-reconciliation").innerHTML =
            `<h3>Class reconciliation</h3>${table("Class reconciliation", ["Issued", "Recorded", "Verified", "Unverified", "Unrecorded", "Ledger", "Result"], `<tr><td>${shares(row.issuedShares)}</td><td>${shares(row.recordedShares)}</td><td>${shares(row.verifiedShares)}</td><td>${shares(row.unverifiedShares)}</td><td>${shares(row.unrecordedShares)}</td><td>${shares(row.ledgerShares)}</td><td>${row.reconciled ? "Reconciled" : "STOP: totals differ"}</td></tr>`)}`;
      } catch (error) {
        status(error.message);
      } finally {
        button.disabled = false;
      }
    };
  const opening = document.querySelector("#opening-editor");
  opening.onsubmit = (event) => {
    event.preventDefault();
    const payload = formValue(opening);
    for (const key of ["verifiedAt", "effectiveAt"])
      payload[key] = new Date(payload[key]).toISOString();
    run(
      opening.querySelector("button"),
      () => api("/api/admin/holdings/openings", payload),
      "holdings",
      "Opening recorded with an immutable event and audit entry.",
    );
  };
  const choice = document.querySelector("#holding-choice"),
    correction = document.querySelector("#correction-editor"),
    legacy = document.querySelector("#legacy-editor");
  choice.onchange = () => {
    const row = data.holdings.find((item) => item.id === choice.value);
    document.querySelector("#holding-status").textContent = row
      ? `${shares(row.quantity)} shares / ${row.verificationRequired ? "Verification required" : row.ownershipPercentage + "% of this class"}`
      : "Select a holding before making a correction or viewing history.";
    legacy.hidden = !row?.verificationRequired;
    correction.querySelector("button").disabled =
      !row || row.verificationRequired;
    document.querySelector("#holding-history-result").replaceChildren();
  };
  if (initial.holdingId) choice.value = initial.holdingId;
  choice.dispatchEvent(new Event("change"));
  for (const [form, path] of [
    [correction, "adjustments"],
    [legacy, "verify"],
  ])
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!choice.value) {
        status("Select an existing holding.");
        return;
      }
      const payload = formValue(form);
      for (const key of ["verifiedAt", "effectiveAt"])
        if (payload[key]) payload[key] = new Date(payload[key]).toISOString();
      run(
        form.querySelector("button"),
        () => api(`/api/admin/holdings/${choice.value}/${path}`, payload),
        "holdings",
        "Holding event recorded and audited.",
      );
    };
  document.querySelector("#holding-history").onclick = async () => {
    if (!choice.value) {
      status("Select a holding first.");
      return;
    }
    try {
      const rows = await list(`/api/admin/holdings/${choice.value}/events`);
      if (isCurrent())
        document.querySelector("#holding-history-result").innerHTML = table(
          "Holding event history",
          ["Sequence / kind", "Before", "Change", "After", "Source / reason"],
          rows
            .map(
              (row) =>
                `<tr><td>${row.sequence} / ${esc(row.kind)}</td><td>${shares(row.beforeQuantity)}</td><td>${shares(row.delta)}</td><td>${shares(row.afterQuantity)}</td><td>${esc(row.sourceReference)}<br>${esc(row.reason)}</td></tr>`,
            )
            .join(""),
        );
    } catch (error) {
      status(error.message);
    }
  };
  function showImport(value) {
    if (!isCurrent()) return;
    batch = value;
    document.querySelector("#import-result").innerHTML = importReport(value);
    document.querySelector("#download-import-report").onclick = () => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(batch, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "nycap-opening-validation.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const button = document.querySelector("#commit-import"),
      confirm = document.querySelector("#import-confirm");
    if (button) {
      confirm.onchange = () => (button.disabled = !confirm.checked);
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await api(
            `/api/admin/imports/${batch.batchId}/commit`,
            { confirm: true },
          );
          if (isCurrent())
            await refresh({
              tab: "imports",
              receipt: result,
              message: result.replayed
                ? "Existing import receipt returned. No duplicate rows were written."
                : "Entire import committed and reconciled.",
            });
        } catch (error) {
          if (isCurrent()) {
            if (error.data?.report) showImport(error.data);
            status(error.message);
          }
        }
      };
    }
  }
  if (batch) showImport(batch);
  const preview = document.querySelector("#csv-preview");
  preview.elements.file.onchange = () => {
    batch = null;
    document.querySelector("#import-result").replaceChildren();
  };
  preview.onsubmit = async (event) => {
    event.preventDefault();
    const file = preview.elements.file.files[0],
      button = preview.querySelector("button");
    if (!file || file.size > 131072) {
      status("Choose a CSV no larger than 128 KiB.");
      return;
    }
    button.disabled = true;
    try {
      const csv = await file.text();
      if (!isCurrent()) return;
      const result = await api("/api/admin/imports/preview", {
        csv,
        reason: preview.elements.reason.value,
      });
      if (isCurrent()) showImport(result);
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  };
  for (const button of document.querySelectorAll("[data-import-view]"))
    button.onclick = async () => {
      try {
        const result = await api(
          "/api/admin/imports/" + button.dataset.importView,
        );
        if (isCurrent()) showImport(result);
      } catch (error) {
        status(error.message);
      }
    };
}

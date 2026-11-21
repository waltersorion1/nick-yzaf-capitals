export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const shares = (value) => BigInt(value).toLocaleString("en-US");
const companyLink = (row) =>
  `<a href="#company/${escape(row.shareClass.company.id)}">${escape(row.shareClass.company.name)} <span aria-hidden="true">&#8599;</span></a>`;
export function card(label, value, note) {
  return `<article class="metric"><p>${escape(label)}</p><strong>${escape(value)}</strong><small>${escape(note)}</small></article>`;
}
export function table(rows, admin = false) {
  if (!rows.length)
    return empty(
      "No holdings to display",
      admin
        ? "No records have been added to this register."
        : "Only verified holdings linked to your account appear here. Contact your administrator if a record is missing.",
    );
  return `<p class="scroll-hint">Scroll the table to see all share details.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable share records"><table class="table"><caption class="sr-only">${admin ? "Register" : "Your"} holdings by company and share class</caption><thead><tr><th scope="col">Company</th><th scope="col">Share class</th><th scope="col" class="numeric">Shares</th><th scope="col" class="numeric">Class ownership</th><th scope="col">Status</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${companyLink(row)}</td><td>${escape(row.shareClass.name)}</td><td class="numeric">${shares(row.quantity)}</td><td class="numeric">${row.ownershipPercentage === null ? "Not available" : escape(row.ownershipPercentage) + "%"}</td><td><span class="badge-status ${row.verificationRequired ? "pending" : ""}">${row.verificationRequired ? "Verification required" : "Verified"}</span></td></tr>`).join("")}</tbody></table></div>`;
}
export function empty(title, text) {
  return `<section class="empty"><span class="empty-symbol" aria-hidden="true">&#9671;</span><h2>${escape(title)}</h2><p>${escape(text)}</p></section>`;
}
export function heading(kicker, title, text, extra = "") {
  return `<div class="page-heading"><div><p class="eyebrow">${escape(kicker)}</p><h1>${escape(title)}</h1><p>${escape(text)}</p></div>${extra}</div>`;
}
export function login() {
  return `<div class="login-layout"><section class="welcome"><p class="eyebrow">OWNERSHIP, WITH CLARITY</p><h1>Your stake.<br>Your perspective.</h1><p>A private space to understand your verified holdings across the companies you are part of.</p><div class="welcome-art" aria-hidden="true"><span></span><span></span><span></span></div><small>Existing shareholders only. No public registration.</small></section><section class="panel login-panel"><p class="eyebrow">WELCOME BACK</p><h2>Sign in to NyCap</h2><p>Access your private shareholder register.</p><form id="login"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="128" required><button class="primary full">Sign in securely <span aria-hidden="true">&#8594;</span></button></form><p id="form-message" role="alert"></p><details class="invitation"><summary>Have an invitation?</summary><form id="invite"><label for="token">Invitation token</label><input id="token" name="token" pattern="[a-f0-9]{64}" autocomplete="off" required><label for="new-password">New password (12-128 characters)</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><button class="primary full">Activate account</button></form></details><small class="login-note">Secure sessions. No private records stored offline.</small></section></div>`;
}

export function classTable(classes) {
  return classes.length
    ? `<section class="panel"><h2>Share-class register</h2><p class="scroll-hint">Scroll the table to see all share details.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Scrollable share records"><table class="table"><caption class="sr-only">Registered class totals used as ownership denominators</caption><thead><tr><th scope="col">Class</th><th scope="col" class="numeric">Registered issued shares</th></tr></thead><tbody>${classes.map((cls) => `<tr><td>${escape(cls.name)}</td><td class="numeric">${shares(cls.issuedShares)}</td></tr>`).join("")}</tbody></table></div></section>`
    : "";
}

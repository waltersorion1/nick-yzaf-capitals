# NyCap private pilot sign-off

**Decision: NO-GO. No pilot invitations authorized or sent.**

Target requested by owner: Hostinger KVM 2 VPS, `https://capital.nickyzaf.xyz`. Date: 21 November 2026 (Africa/Lagos). Day 6 is tested and pushed as `72fb2f4`. Local production-like checks are separate from live-origin evidence.

## Gates and evidence to record

- [x] Day 6 backend/security suites: 79 tests; desktop/mobile browser suites: 30 tests.
- [x] Day 6 real fictional restore: 12 tables and 100 schema-guard definitions matched, sessions empty, ledger/capacity and immutable guards passed. See docs/TEST_REPORT.md.
- [x] Local Day 7 production-mode checks: 82 backend / 30 browser regressions, internal-CA HTTPS/secure sessions, restricted roles, actual image worker update and age-encrypted restore passed. This is **not** live VPS/ACME/device/source sign-off; see docs/DAY7_REPORT.md.
- [ ] Verified SSH target/user/key and authorized deployment directory supplied; existing host services/ports inventoried and preserved.
- [ ] DNS A/AAAA correctly targets the VPS. Latest local `Resolve-DnsName capital.nickyzaf.xyz -Type A` returned DNS name does not exist; do not assume SSH-config hosts belong to this project.
- [ ] Live restricted origin deployed with valid publicly trusted HTTPS, automatic renewal, one trusted proxy, Secure/HttpOnly/SameSite sessions, exact APP_ORIGIN and private backend/DB ports.
- [ ] Live manifest/icons/scope/no-store/offline/update/account isolation smoke tests executed, with release hash/date/tester recorded.
- [ ] Physical Android/desktop installation/reopen tests and iOS Safari checklist executed. Emulation is narrower evidence.
- [ ] Approved encrypted **off-host** backup destination, retention, RPO/RTO, alert/key-recovery owner and schedule configured. Local same-VPS encrypted archives alone are insufficient.
- [ ] Restore drill from the actual off-host encrypted archive/key performed in a NEW nonproduction database; exact source reconciliation and session invalidation verified.
- [ ] Human-verified company/shareholder source files and signed registers made available at an identified private path. Owner says they exist; this task has not received them or inspected their signatures/content.
- [ ] Source reviewer/date/signature reference and file SHA-256 recorded privately; company/class/profile mappings verified by a human.
- [ ] Reviewed CSV preview accepted, committed transactionally and class-by-class totals reconciled against the signed register. Record batch/receipt IDs privately, exact issued/existing/imported/final/unrecorded totals and independent reviewer approval. Never publish personal source rows in this file.
- [ ] Owner explicitly approves security, accuracy and restoration evidence and names the small pilot group. **This box cannot be checked by the agent on the owner's behalf.**
- [ ] Only after all gates: authorized invitation delivery, with private tokens and no public registration.

## Owner approvals (unfilled)

| Approval                                          | Owner / date / private evidence reference |
| ------------------------------------------------- | ----------------------------------------- |
| Security and live HTTPS/privacy                   | Pending                                   |
| Signed source accuracy and reconciliation         | Pending                                   |
| Off-host recovery and retention                   | Pending                                   |
| Device installation/reopen acceptance             | Pending                                   |
| Pilot group and explicit invitation authorization | Pending                                   |

No real source import, real administrator bootstrap, deployment to Hostinger, DNS change, paid backup purchase or pilot invitation is inferred from a local smoke test. Resolve every unchecked launch gate before changing the decision to GO. See docs/DAY7_REPORT.md for final executed results and blockers.

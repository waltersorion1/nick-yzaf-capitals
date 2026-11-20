# NyCap agent working agreement

## Golden rule: complete, test, commit, and push

After completing a day's objective and successfully running the checks required for that day, commit all project changes for that completed day and push them to the connected GitHub repository's `main` branch. This is standing authorization from the project owner; do not ask for confirmation again for this routine commit and push.

- Read `Codex_Playbook.md` completely before implementing a day. Execute only the requested day and stop after that day's work and delivery.
- Complete the implementation and run the relevant tests and day gates before committing. Never claim an unexecuted check passed. Document failures, untested areas, and limitations honestly.
- Include the day's source, migrations, fictional seed data, tests, lockfile, documentation, and report in the commit. Exclude secrets, `.env`, credentials, dependency directories, build artifacts, and unrelated personal files.
- Check Git status, the connected remote, and remote `main` before delivery. Preserve the owner's work. Resolve routine integration issues without discarding changes; never force-push or rewrite shared history.
- Use a clear commit message describing the completed day. Push to `origin/main` and verify that local `HEAD` matches remote `main`.
- If a required test fails or GitHub rejects the push, fix the issue when possible. Otherwise report the exact blocker; never describe the day as successfully delivered to GitHub.
- Report the commit hash, push result, executed checks, migration status, known limitations, and next dependencies in the handoff.

## Project boundaries

Follow the playbook's locked stack, security baseline, fictional-data rule, and PWA privacy contract. Explain unfamiliar TypeScript, PostgreSQL, and Prisma syntax using JavaScript/MySQL comparisons. Do not add later-day features, real investor data, financial transactions, or deployment without an applicable request.

`AGENTS.md` is the single repository instruction file for coding agents.

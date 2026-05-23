---
tags: [features, email, gmail, workflow]
updated: 2026-04-12
---

# Email Workflow (Gmail via Claude/MCP)

This app does **not** send emails directly. It tracks email status in Firestore and uses a Gmail MCP tool (via Claude) to create drafts.

## Scoped Group

The email feature operates on a single group at a time. The active group name is read from `APP_CONFIG.tournament.emailGroup` in `src/config/app.js`, which is driven by the `EMAIL_GROUP` env var. Leave the env var empty to disable the workflow.

## Entry `emailSent` Field

Each entry in `tournaments/{year}/entries/{entryId}` can have `emailSent: true`. Absent or false means not yet emailed. Set via `POST /admin/mark-emails-sent`.

Can be toggled manually per-entry via the **Bracket Email Sent** checkbox in admin Edit Entry page (`/viewEntry`). Uncheck to reset an entry back to "unsent."

## Email Flow

1. Admin opens **Entries** page and clicks **Check Unsent Bracket Emails**.
2. Calls `GET /admin/unsent-emails?year=<year>` — shows all entries in the configured `EMAIL_GROUP` where `emailSent` is not `true`.
3. Admin shares the list with their AI assistant of choice (via **Copy Entry Data** button).
4. The assistant uses a Gmail MCP tool (or any other email integration) to create one draft per entry with person's team name, 10 picks, and their editable bracket link (`/my-entry/edit?entryId=<id>&year=<year>`).
5. Admin reviews drafts in Gmail and sends.
6. Admin clicks **Mark All as Sent** — calls `POST /admin/mark-emails-sent`.

## Key Files

| File | Purpose |
|------|---------|
| `src/services/emailService.js` | Reads `EMAIL_GROUP` from `APP_CONFIG.tournament.emailGroup`. `getUnsentEmailEntries(year)`. `markEmailsSent(entryIds, year)`. |
| `src/repositories/hierarchicalRepository.js` | `EntryRepository.getUnsentEmailEntries(groupName, year)`. `EntryRepository.markEmailsSent(entryIds, year)`. `GameRepository.updateEntry()` — also writes `emailSent` when present on payload. |
| `views/adminEntries.ejs` | Check Unsent Bracket Emails button, modal, Copy Entry Data button, Mark All as Sent button. |
| `views/editEntry.ejs` | **Bracket Email Sent** checkbox — visible when `fromAdmin` is true. |

## Related Files

- `docs/features/routes.md` — Email route definitions (`GET /admin/unsent-emails`, `POST /admin/mark-emails-sent`)
- `docs/architecture/database.md` — `emailSent` field on the entry document schema

---
tags: [features, espn, polling, cloud-scheduler]
updated: 2026-05-09
---

# ESPN Game Score Auto-Polling

Game results are updated automatically via ESPN's unofficial scoreboard API (free, no auth required).

## Architecture

```
Cloud Scheduler (every 15 min, tournament windows)
  → Cloud Run Jobs API (OAuth, no shared secret)
    → Cloud Run Job: espn-poll  [jobs/espn-poll.js]
      → pollService.runEspnPoll(year)
        → espnService.fetchCompletedTournamentGames()  ← ESPN API
        → match ESPN team displayNames → internal sID via espnTeamMap.json
        → call updateTeamRecords() + updateTotalPointsJustYear() for new winners
```

Admin console dry-run (no DB writes):
```
POST /admin/trigger-espn-poll  (session-authenticated)
  → gameController.triggerEspnPoll → pollService.runEspnPoll(year, { dryRun: true })
```

## Key Files

| File | Purpose |
|------|---------|
| `src/services/espnService.js` | Fetches ESPN scoreboard for today's date. Returns completed games with winner/loser `displayName`. |
| `src/services/pollService.js` | `runEspnPoll(year, { dryRun })` — matches ESPN results to DB, writes if `dryRun: false` (default). |
| `src/config/espnTeamMap.json` | Static JSON mapping ESPN `displayName` → internal `sID`. Must be populated before tournament. |
| `jobs/espn-poll.js` | Cloud Run Job entrypoint. Reads `POLL_YEAR` env var, calls `runEspnPoll`, exits 0/1. |
| `jobs/package.json` | Minimal package manifest for the job: runtime dependency is `@google-cloud/firestore`; `esbuild` is build-only. |
| `Dockerfile.poll` | Multi-stage build: esbuild bundles everything into `dist/poll.mjs`; final image has no `node_modules`. |
| `cloudbuild.poll.yaml` | Cloud Build config — builds `Dockerfile.poll`, pushes to Artifact Registry, updates the Cloud Run Job. |
| `scripts/buildEspnMap.js` | One-time setup script. Run: `node scripts/buildEspnMap.js 2026` |
| `scripts/enrichEspnData.js` | Enriches `school` collection with ESPN branding data. |

## Cloud Run Job Artifact

The `espn-poll-job` Docker image is kept small via a two-stage build in `Dockerfile.poll`:

1. **Builder stage** — installs deps from `jobs/package.json`, runs esbuild to bundle `jobs/espn-poll.js` and the full `src/` import tree into a single `dist/poll.mjs` (~4.3 MB uncompressed).
2. **Production stage** — copies only `poll.mjs` into the distroless image. No `node_modules` directory.

The bundle uses an ESM banner polyfill to handle `require()` and `__dirname` calls inside CommonJS npm packages:
```
--banner:js="import {createRequire as __cjsRequire} from 'module'; ..."
```

`espnTeamMap.json` is loaded at runtime via `createRequire` inside `pollService.js`. esbuild cannot statically inline it through that pattern, so it is resolved from the bundled `require` polyfill at runtime (the path resolves relative to the bundle file). This works correctly in the container.

## Keeping `jobs/` Dependencies in Sync

`jobs/package.json` is a completely separate manifest from the root — `npm install` at the repo root does **not** touch it. The Docker build uses `jobs/package-lock.json` exclusively.

`@google-cloud/firestore` appears in both `package.json` files and can drift. Whenever it is updated at the root, run the same command in `jobs/` too:

```bash
# example: upgrading Firestore
npm install @google-cloud/firestore@latest
cd jobs && npm install @google-cloud/firestore@latest
```

`esbuild` (devDep in `jobs/`) is only used at Docker build time — it doesn't need to stay in sync with anything in the root.

**If the bundle needs to be rebuilt** (e.g. after changing `pollService.js` or `espnTeamMap.json`):
```bash
gcloud builds submit --config cloudbuild.poll.yaml --project=$GCP_PROJECT_ID .
```

## Team Name Mapping

ESPN uses `displayName` = `nameNick + " " + mascot` (e.g. `"Duke Blue Devils"`). `buildEspnMap.js` auto-matches against the DB. Any `null` entries must be filled in manually before the tournament starts.

## Cloud Scheduler Setup

One job per game day (afternoon/evening window) plus one overnight job (midnight–2AM next day). Each job targets a specific date using the `day-of-month` and `month` cron fields. All times ET.

For the full list of jobs and gcloud commands to create them, see `docs/tournament/espn-setup.md`.

## `dryRun` Option

`runEspnPoll(year, { dryRun: true })` skips all DB writes and returns:
```json
{ "updated": 2, "skipped": 1, "unmapped": [], "games": [
  { "gameID": 5, "round": 1, "winnerSID": 28, "winnerDisplayName": "Duke Blue Devils" }
]}
```

## ESPN School Data Enrichment

```bash
# Single team
GCP_PROJECT_ID=$GCP_PROJECT_ID node scripts/enrichEspnData.js "Arkansas Razorbacks"

# All teams in espnTeamMap.json (skips already enriched)
GCP_PROJECT_ID=$GCP_PROJECT_ID node scripts/enrichEspnData.js

# Preview without writing
node scripts/enrichEspnData.js "Arkansas Razorbacks" --dry-run

# Re-fetch and overwrite existing data
GCP_PROJECT_ID=$GCP_PROJECT_ID node scripts/enrichEspnData.js "Arkansas Razorbacks" --force
```

See `docs/architecture/database.md` for the full ESPN school data schema.

## Related Files

- `docs/tournament/espn-setup.md` — Annual activation checklist, Cloud Scheduler job creation
- `docs/tournament/espn-api-notes.md` — API response structure, historical import strategy
- `docs/tournament/espn-tournament-dates.md` — Date schedules by year and round

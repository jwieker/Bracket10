---
tags: [tournament, espn, setup, cloud-scheduler]
updated: 2026-05-06
---

# ESPN Setup: New Year Activation & Historical Import

## Activating ESPN Polling for a New Tournament Year

Follow these steps in order each year after the bracket is announced.

> **Polling architecture (as of 2026-04-20):** Polling runs as a Cloud Run Job (`espn-poll`), not via the web server HTTP endpoint. Cloud Scheduler triggers the job directly via the Cloud Run Jobs API using OAuth. The old `POST /admin/espn-poll` endpoint and `POLL_SECRET` secret have been removed.

### Step 1 — Verify service account IAM for the Cloud Run Job

The job must run under a service account with Firestore read/write access:

```bash
# Check which SA the job uses
gcloud run jobs describe espn-poll --region us-central1 \
  --format="value(spec.template.spec.serviceAccountName)"

# Confirm it has the Firestore role
gcloud projects get-iam-policy $PROJECT \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:<SA_EMAIL>" \
  --format="table(bindings.role)"
# Should include: roles/datastore.user (or roles/datastore.owner)
```

### Step 2 — Build the team name map

Run after Selection Sunday (bracket announced):
```bash
node scripts/buildEspnMap.js YYYY
```

Auto-matches ESPN display names against Firestore `schoolRecords` and writes to `src/config/espnTeamMap.json`. Any unmatched teams appear as `null` — fill them in manually before the first game.

> All `null` entries must be fixed before tip-off. For tournaments with First Four enabled, there should be exactly **68 teams**.

Look up `sID` values in the Firestore `school` collection.

### Step 3 — Update `currentYear` in `src/config/app.js`

Change the year to match the new tournament.

### Step 4 — Deploy

```bash
git push origin main
```

Wait for Cloud Run deployment to complete before setting up the scheduler.

### Step 4b — Rebuild and redeploy the job image (when code changes)

If `pollService.js`, `espnService.js`, `espnTeamMap.json`, or `POLL_YEAR` need updating:

```bash
# Build and push using the existing config (targets us-central1 Artifact Registry)
gcloud builds submit --config cloudbuild.poll.yaml --project=$PROJECT .

# Update the Cloud Run Job to use the new image
gcloud run jobs update espn-poll \
  --image us-central1-docker.pkg.dev/$PROJECT/espn-poll/espn-poll-job \
  --region us-central1
```

The build uses `Dockerfile.poll`, which runs esbuild to bundle the entire poll job (all `src/` imports + `node_modules`) into a single `dist/poll.mjs`. The final image contains only that file — no `node_modules` directory. See `docs/features/espn-polling.md` → "Cloud Run Job Artifact" for details.

### Step 5 — Test the job manually

```bash
# Execute the Cloud Run Job once and tail the logs
gcloud run jobs execute espn-poll --region us-central1 --wait
```

Expected output in Cloud Logging when no games have finished:
```json
{ "severity": "INFO", "message": "ESPN poll job complete", "data": { "updated": 0, "skipped": 0, "unmapped": [], "games": [] } }
```

If you see `unmapped` team names in the summary, add them to `espnTeamMap.json`, rebuild the job image, and update the job.

For a dry-run preview from the admin UI: log in at `/updates` and click **"Poll ESPN"** — this hits `/admin/trigger-espn-poll` (session-authenticated, no DB writes).

### Step 6 — Set up Cloud Scheduler jobs

Two jobs per game day: one afternoon/evening job and one overnight job (midnight–2AM next calendar day). All jobs target specific dates via `day-of-month` and `month` cron fields.

Start times are rounded down to the top of the hour (e.g. 1:30PM → 1:00PM start).

Scheduler triggers the Cloud Run Job via the Jobs API using OAuth — no shared secret needed.

```bash
# Delete old HTTP-endpoint scheduler jobs if they exist
gcloud scheduler jobs delete espn-poll-day --project=$PROJECT --location=us-central1 --quiet
gcloud scheduler jobs delete espn-poll-night --project=$PROJECT --location=us-central1 --quiet

# Helper variables
PROJECT=$PROJECT
LOCATION=us-central1
SA_EMAIL=<your-service-account>@$PROJECT.iam.gserviceaccount.com
JOB_URI=https://us-central1-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/espn-poll:run

# ── WEEK 1 — First Four ──────────────────────────────────────────────────────

# Tue Mar 17: 8PM–midnight
gcloud scheduler jobs create http espn-poll-mar17 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 20-23 17 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Wed Mar 18: midnight–2AM (tail of Tue window)
gcloud scheduler jobs create http espn-poll-mar18-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 18 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Wed Mar 18: 8PM–midnight
gcloud scheduler jobs create http espn-poll-mar18 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 20-23 18 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Thu Mar 19: midnight–2AM (tail of Wed window)
gcloud scheduler jobs create http espn-poll-mar19-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 19 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 1 — Round of 64 ─────────────────────────────────────────────────────

# Thu Mar 19: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar19 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 19 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Fri Mar 20: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar20-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 20 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Fri Mar 20: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar20 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 20 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sat Mar 21: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar21-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 21 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 1 — Round of 32 ─────────────────────────────────────────────────────

# Sat Mar 21: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar21 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 21 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sun Mar 22: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar22-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 22 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sun Mar 22: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar22 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 22 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Mon Mar 23: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar23-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 23 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 2 — Sweet 16 ────────────────────────────────────────────────────────

# Thu Mar 26: 4PM–midnight  (requested 4:30PM, starts at 4:00PM)
gcloud scheduler jobs create http espn-poll-mar26 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 16-23 26 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Fri Mar 27: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar27-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 27 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Fri Mar 27: 4PM–midnight  (requested 4:30PM, starts at 4:00PM)
gcloud scheduler jobs create http espn-poll-mar27 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 16-23 27 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sat Mar 28: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar28-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 28 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 2 — Elite Eight ─────────────────────────────────────────────────────

# Sat Mar 28: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar28 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 28 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sun Mar 29: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar29-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 29 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sun Mar 29: 1PM–midnight  (requested 1:30PM, starts at 1:00PM)
gcloud scheduler jobs create http espn-poll-mar29 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 13-23 29 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Mon Mar 30: midnight–2AM
gcloud scheduler jobs create http espn-poll-mar30-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 30 3 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 3 — Final Four ──────────────────────────────────────────────────────

# Sat Apr 4: 5PM–midnight  (requested 5:30PM, starts at 5:00PM)
gcloud scheduler jobs create http espn-poll-apr04 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 17-23 4 4 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Sun Apr 5: midnight–2AM
gcloud scheduler jobs create http espn-poll-apr05-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 5 4 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# ── WEEK 3 — Championship ────────────────────────────────────────────────────

# Mon Apr 6: 7PM–midnight  (requested 7:30PM, starts at 7:00PM)
gcloud scheduler jobs create http espn-poll-apr06 \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 19-23 6 4 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL

# Tue Apr 7: midnight–2AM
gcloud scheduler jobs create http espn-poll-apr07-night \
  --project=$PROJECT --location=$LOCATION \
  --schedule="*/15 0-1 7 4 *" --time-zone="America/New_York" \
  --uri=$JOB_URI --http-method=POST \
  --oauth-service-account-email=$SA_EMAIL
```

```bash
gcloud scheduler jobs list --project=$PROJECT --location=us-central1
```

> **Next year:** delete all `espn-poll-*` jobs and re-run the create commands above with updated dates. Cron schedules repeat annually on the same calendar day, so existing jobs from a prior year will fire again unless deleted.

### Step 7 — Monitor during the tournament

From the admin UI: log in at `/updates`, click **"Poll ESPN"** for a preview of what games ESPN has marked finished (no DB writes). If the preview looks correct, the scheduler is handling actual updates.

From Cloud Run logs, filter by `ESPN poll`:
```
ESPN poll: recording winner sID=28 for game 5 (round 1)
ESPN poll complete — updated: 2, skipped: 0, unmapped teams: 0
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `"updated": 0` but games finished | Team not in `espnTeamMap.json` | Check `unmapped` array in logs, add to map, rebuild job image |
| `unmapped` teams in logs | New team name ESPN hasn't seen | Add displayName → sID to `espnTeamMap.json`, rebuild |
| Job exits 1 / Firestore writes failing | SA missing `roles/datastore.user` | Grant IAM role to job's service account |
| Scheduler not firing | Job paused or wrong region | `gcloud scheduler jobs resume <job-name> --location=us-central1` |
| Games updated incorrectly | Wrong sID in map | Fix map, use admin Undo to roll back, rebuild job |

---

## Historical Tournament Import

To import a historical year, use a two-phase approach: build bracket structure first, then fill in winners.

### ESPN API Endpoint

```
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=200&dates=YYYYMMDD
```

Unofficial/undocumented public API. Data available from **2009 to present** (2008 and earlier return empty). 2020 was cancelled — skip it entirely.

### Phase 1 — Build the Bracket Structure

Call `createNewBracket(gamesData, year, regionArray)` with:

- `regionArray` — 4 region IDs in bracket order, e.g. `[1, 2, 3, 4]`
  - Region IDs are fixed: `1=East, 2=West, 3=South, 4=Midwest` (see `src/config/const.js`)
  - Order controls which game ID block each region gets (Region 1 → games 1–15, Region 2 → games 16–30, etc.)

- `gamesData` — 32 strings formatted as `"regionID-gameID-seed-sID"`, in pairs (team1, team2 per game)
  - Game IDs: Region 1 = games 1–8, Region 2 = 16–23, Region 3 = 31–38, Region 4 = 46–53
  - Seed pairing order: `1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15`

The game tree (`nextGameID`/`nextGameSpot` wiring) is fully algorithmic — `createNewBracket` handles all of it.

**Best data source for historical bracket structure:** `https://www.sports-reference.com/cbb/postseason/men/{YEAR}-ncaa.html`

**sID mapping:** You need internal `sID`s, not display names. Build/maintain a lookup table in `src/config/espnTeamMap.json`. Handle known aliases (e.g. `"UConn"` vs `"Connecticut Huskies"`). Any team not in the `schools` collection must be added via the admin UI before the import.

### Phase 2 — Fill In Winners

Use `pollService.js` with the ESPN scoreboard dates from `docs/tournament/espn-tournament-dates.md` to walk through each round.

**Import order per year:**
1. Verify all 64 teams exist in `schools` collection
2. Build/verify the name map for that year's teams
3. Call `createNewBracket` with seed data and region array
4. Verify the bracket in the admin UI
5. Walk ESPN scoreboard dates chronologically, recording winners round by round
6. Run `updateTotalPoints` after all rounds are complete

### First Four Handling

Starting in 2026, First Four games are fully modeled as Round 0.
- **Auto-Poll Support:** `pollService` supports auto-polling Round 0 just like any other round.
- **Registration:** Users pick "Team A / Team B" slots during the First Four period.
- **Resolution:** `updateTeamRecords` (Round 0 handler) automatically promotes the winner and swaps picks.

For historical imports (2011–2025), the simplest approach remains to exclude the play-in games and build the bracket with the known winners as the 64 R1 participants.

### Year-Specific Notes

| Year | Notes |
|------|-------|
| 2009–2010 | 1 play-in game (not First Four). 65-team field. |
| 2011+ | First Four introduced — 68-team field. |
| 2020 | **Skip entirely.** Tournament cancelled. |
| 2021 | COVID bubble (all games in Indianapolis). ESPN groupings differ — verify game counts per date manually. |

## Related Files

- `docs/tournament/espn-api-notes.md` — API response structure, Phase 1 & 2 detailed strategy
- `docs/tournament/espn-tournament-dates.md` — Date schedules by year and round
- `docs/features/espn-polling.md` — Runtime polling architecture (pollService, espnTeamMap, dryRun)

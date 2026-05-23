---
tags: [tournament, espn, api, import]
updated: 2026-04-12
---

# ESPN Scoreboard API — Notes & Import Strategy

Documents how the ESPN scoreboard API works, what data it returns, and how to use it to import historical NCAA tournament data. For the actual query dates needed per year and round, see `espn-tournament-dates.md`.

## API Endpoint

```
https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?limit=200&dates=YYYYMMDD
```

Unofficial/undocumented ESPN public API. Accepts any date in `YYYYMMDD` format and returns all college basketball games for that day.

## Historical Data Availability

| Year | First Round Thursday | Games Returned | Notes |
|------|----------------------|----------------|-------|
| 2025 | March 20 (20250320) | 16 | ✅ |
| 2024 | March 21 (20240321) | 16 | ✅ |
| 2023 | March 16 (20230316) | 16 | ✅ |
| 2022 | March 17 (20220317) | 16 | ✅ |
| 2021 | March 18 (20210318) | 4  | ✅ COVID bubble — games grouped differently |
| 2020 | —                    | —  | ❌ Tournament cancelled (COVID-19) |
| 2019 | March 21 (20190321) | 16 | ✅ |
| 2018 | March 15 (20180315) | 16 | ✅ |
| 2017 | March 16 (20170316) | 16 | ✅ |
| 2016 | March 17 (20160317) | 16 | ✅ |
| 2015 | March 19 (20150319) | 16 | ✅ |
| 2014 | March 20 (20140320) | 16 | ✅ |
| 2013 | March 21 (20130321) | 16 | ✅ |
| 2012 | March 15 (20120315) | 16 | ✅ |
| 2011 | March 17 (20110317) | 16 | ✅ |
| 2010 | March 18 (20100318) | 16 | ✅ |
| 2009 | March 19 (20090319) | 16 | ✅ |
| 2008 | March 20 (20080320) | 0  | ❌ No data — hard cutoff |

**Total: 16 years of usable data (2009–2025, minus 2020)**

## Response Structure (Relevant Fields)

The `curatedRank.current` field carries the tournament seed number.

```json
{
  "events": [
    {
      "id": "espnEventId",
      "status": {
        "type": {
          "completed": true
        }
      },
      "competitions": [
        {
          "competitors": [
            {
              "winner": true,
              "team": {
                "displayName": "Duke Blue Devils"
              }
            },
            {
              "winner": false,
              "team": {
                "displayName": "Vermont Catamounts"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

## Historical Import Strategy

Importing a historical year is a **two-phase process**: build the bracket structure first, then fill in the winners. Get Phase 1 right before touching Phase 2.

### Phase 1 — Build the Bracket Structure

Goal: call `createNewBracket(gamesData, year, regionArray)` with correct data.

**What `createNewBracket` needs:**

- `regionArray` — array of 4 region IDs in bracket order (e.g. `[1, 2, 3, 4]`)
  - Region IDs are fixed: `1=East, 2=West, 3=South, 4=Midwest` (see `src/config/const.js`)
  - Order determines which region gets which game ID block (Region 1 → games 1–15, Region 2 → 16–30, etc.)

- `gamesData` — 32 strings, one per team in Round 1, formatted as `"regionID-gameID-seed-sID"`, in pairs
  - Game IDs: Region 1 = 1–8, Region 2 = 16–23, Region 3 = 31–38, Region 4 = 46–53
  - Seed pairing order: `1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15`

The game ID structure is **fully algorithmic** — `createNewBracket` handles all `nextGameID`/`nextGameSpot` wiring automatically.

**Best external source for historical bracket data:** `https://www.sports-reference.com/cbb/postseason/men/{YEAR}-ncaa.html`

**The sID mapping problem:** `createNewBracket` needs internal `sID`s, not display names. Maintain a lookup table at `src/config/espnTeamMap.json`. Handle known aliases (e.g. `"UConn"` vs `"Connecticut Huskies"`). Any team missing from the `schools` collection must be added via the admin UI first.

### Phase 2 — Fill In Winners

Use `pollService.js` with dates from `espn-tournament-dates.md`. Round assignment comes purely from which date you query — there is no round field in the ESPN response.

**Suggested import order per year:**
1. Verify all 64 teams exist in `schools` collection
2. Build/verify `team-name-map.json` entries for that year
3. Call `createNewBracket` with seed data and region array
4. Verify the bracket in the admin UI
5. Walk ESPN scoreboard dates chronologically, recording winners round by round
6. Run `updateTotalPoints` after all rounds are complete

### First Four Handling

Round 0 is fully modeled starting in 2026.
- **Round Number:** 0
- **Game IDs:** 64–67
- **Region ID:** 7 (First Four)
- **Points:** 0
- **Auto-Resolution:** Resolving an FF game auto-populates the winner into the linked R1 slot and swaps registration picks.

For 2011–2025 (historical), the system can either model FF games as Round 0 or bypass them by building the bracket with the known R1 winners directly.

### Year-Specific Notes

| Year | Notes |
|------|-------|
| 2009 | 1 play-in game (not First Four). 65-team field. |
| 2010 | 1 play-in game (not First Four). 65-team field. |
| 2011 | First Four introduced — 68-team field from here on. |
| 2020 | **Skip entirely.** Tournament cancelled, no games played. |
| 2021 | COVID bubble (all games in Indianapolis). ESPN groupings differ — verify game counts per date manually. |

## Related Files

- `docs/tournament/espn-setup.md` — Annual activation checklist and Cloud Scheduler job setup
- `docs/tournament/espn-tournament-dates.md` — Exact query dates per year and round
- `docs/features/espn-polling.md` — Runtime polling service architecture

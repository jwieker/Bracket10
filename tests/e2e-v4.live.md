## Live E2E V4 Test — Prod-Safe Full Flow (Sentinel Year 9999)

V4 supersedes `e2e-2020.live.test.js` (v1) and `e2e-v2.live.test.js`. It runs the
same full-2022-bracket flow as V2 and adds leaderboard-ranking, idempotency, and
email-lifecycle coverage — with a cleanup model that is safe to run against the
**production** database.

### Prod-safety model (the difference from V2)

V2 cleaned up with wholesale year deletes (`deleteGamesByYear(2020)` etc.) —
"delete everything in the year," not "delete what I created." V4 replaces that:

- **Sentinel year `9999`** — no real tournament can ever exist there.
- **Created-document registry** — every doc the test writes is tracked by
  reference; teardown deletes **exactly those docs** and then verifies each one
  is gone and the year subtree is empty. There are no `delete*ByYear()` calls
  anywhere in the file.
- **Guarded pre-clean** — before seeding, the test inspects year 9999. Leftovers
  that provably match this test's own fingerprint (`E2E-V4` names, `e2ev4`
  emails, spec game/team IDs — i.e. a prior crashed run) are removed. **Any
  document it cannot prove it created aborts the run without deleting
  anything.**

### What this test does

1. Seeds year 9999 with the complete 2022 bracket (64 teams, 63 games, 6 regions).
2. **Verifies bracket shape** (counts, school-name denormalization) and — new in
   V4 — **full topology**: every `nextGameID`/`nextGameSpot` link is consistent,
   each slot is fed by exactly one game, only the championship has no next game.
3. **First Four block** (from V2, extended for the FF lifecycle hardening):
   FF game creation, pick auto-swap on resolution, possPoints path
   correctness, undo with `manualHold` set, write-time pick normalization
   against live game state (unresolved → combined, resolved → winner), the
   full corrective cycle **resolve(B) → undo → re-resolve(A) → undo** with the
   pick following the winner each time, and hold release on re-resolution.
4. Plays round-1 games, verifies winner propagation, undo/rollback (undo sets
   `manualHold`; re-recording the result releases it).
5. **Three entries — Alpha, Beta, Weak** (new in V4):
   - Alpha and Beta have identical picks (deliberate tie); Weak holds eliminated
     teams.
   - Exact `totalPoints`/`possPoints` assertions for each.
   - **`possibleRanking`**: Alpha/Beta both rank 1 with `ties: 1`; Weak ranks 3
     with `ties: 0`; the sorted order users see is asserted.
6. **Elimination check**: upsetting a picked team drops possPoints by exactly
   that team's future contribution; undo restores it.
7. **Idempotency** (new in V4): `updatePossiblePoints` runs twice over the same
   resolved games — entry points and school records must be byte-identical, and
   resolved games must be excluded from the unresolved set the ESPN poll matches
   against (the poll's dedupe predicate).
8. **Multi-round progression**: R1 → R2 → R3 propagation with exact point totals.
9. **Email lifecycle** (new in V4): all entries start unsent →
   `getUnsentEmailEntries` returns exactly them → `markEmailsSent` → they stop
   appearing. Service-level assertions (pickNames enrichment) run when
   `EMAIL_GROUP=E2E-V4` is set (the npm scripts set it); repo-level assertions
   always run.
10. **Entity CRUD** (from V2): conference, school, and group create/update/find,
    with registry-tracked fixtures.
11. **`getAllYearsForGroup` Filter.or() smoke test** (from V2 / PR #120), under
    reserved years 9988/9989.

### Safety and scope

- Disabled by default — runs against the emulator when
  `FIRESTORE_EMULATOR_HOST` is set, or live Firestore with `LIVE_E2E=true`.
- Writes only to: `tournaments/9999/**`, `tournaments/9988|9989` (FilterOr
  block), and three fixed CRUD fixtures (`conferences/e2e-v4-test-conf`,
  `school/999995`, `groups/E2E-V4-CRUD-Group`).
- **Never deletes any document it did not create.** Foreign data in the
  sentinel year aborts the run untouched.

### How to run

```bash
npm run test:e2e-v4        # against the Firestore emulator (default localhost:8085)
npm run test:live-e2e-v4   # against live/prod Firestore (opt-in)
```

Expected output: all assertions pass, and the teardown log confirms every
registered document was deleted and verified gone.

### Data created (and removed)

| Location                               | What is written                   | Cleaned up                    |
| -------------------------------------- | --------------------------------- | ----------------------------- |
| `tournaments/9999` (root doc)          | year marker                       | ✅ registry delete + verify   |
| `tournaments/9999/games`               | 63 bracket games + 1 FF game      | ✅ registry delete + verify   |
| `tournaments/9999/schoolRecords`       | 64 + 2 FF school records          | ✅ registry delete + verify   |
| `tournaments/9999/regions`             | 6 region docs                     | ✅ registry delete + verify   |
| `tournaments/9999/entries`             | 4 entries (Alpha, Beta, Weak, FF) | ✅ in-test deletes + registry |
| `tournaments/9988`, `tournaments/9989` | FilterOr fixtures (1 entry each)  | ✅ targeted deletes           |
| `conferences/e2e-v4-test-conf`         | CRUD fixture                      | ✅ registry delete + verify   |
| `school/999995`                        | CRUD fixture                      | ✅ registry delete + verify   |
| `groups/E2E-V4-CRUD-Group`             | CRUD fixture                      | ✅ registry delete + verify   |

### Troubleshooting

- **"ABORT — year 9999 contains N document(s) this test did not create"** — the
  guard found foreign data in the sentinel year. Nothing was deleted. Inspect
  the listed paths; either they're genuinely foreign (move them) or the
  fingerprint rules in `classifyYearDoc` need updating.
- If the test fails mid-run, the `afterAll` teardown still deletes everything
  registered up to that point; anything it missed is caught by the guarded
  pre-clean on the next run.
- Ensure credentials have read/write/delete on `tournaments`, `school`,
  `groups`, and `conferences` collections.

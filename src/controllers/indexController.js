import { controllerWrapper } from '../utils/controllerUtils.js';
import {
  thisYear,
  bracketLaunchDate,
  tourneyStartDate,
  TOURNAMENT_ROUNDS,
} from '../config/app.js';

// Which of the three home-page states the tournament calendar puts us in.
function resolveHomeState() {
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
  if (isTestEnvironment) return 'test';

  const nowZulu = new Date();
  if (nowZulu <= bracketLaunchDate) return 'comingsoon';
  return nowZulu > tourneyStartDate ? 'tournament' : 'registration';
}

// The per-round ladder shown on the home page, derived from TOURNAMENT_ROUNDS so the
// numbers on the page can't drift from the ones the points engine awards.
// Round 0 (First Four) pays nothing and is called out in prose instead.
function buildLadder() {
  // Carry the round number through the filter instead of re-deriving it from
  // the surviving array index: buildCompareModel below looks its comparison
  // rungs up by `round` (COMPARE_DEEP_ROUND), so a gap in TOURNAMENT_ROUNDS
  // would otherwise renumber every later rung and silently point that lookup
  // at the wrong round — with the matching label and points — on a public page.
  const rounds = [1, 2, 3, 4, 5, 6]
    .map((round) => ({ round, cfg: TOURNAMENT_ROUNDS[round] }))
    .filter(({ cfg }) => cfg);
  const max = rounds.reduce((m, { cfg }) => Math.max(m, cfg.roundPoints), 0);
  return rounds.map(({ round, cfg }) => ({
    round,
    name: cfg.name,
    roundPoints: cfg.roundPoints,
    cumulative: cfg.points,
    barWidth: max ? Math.round((cfg.roundPoints / max) * 100) : 0,
  }));
}

const LAYOUTS = ['comingsoon', 'registration', 'tournament'];

// Which rungs the "one deep run beats N early ones" band compares.
// TOURNAMENT_ROUNDS[5] is the Final Four and [1] the First Round; the round
// numbers are the stable identity, the names and points are not.
const COMPARE_DEEP_ROUND = 5;
const COMPARE_SHALLOW_ROUND = 1;
const COMPARE_SHALLOW_TEAMS = 3;

// The home page reads top to bottom and picks one layout for the current
// calendar state; in test/development only, ?preview= chooses which.
// Production never reaches that branch — resolveHomeState returns 'test'
// nowhere else — so the live page is always calendar-driven.
function buildHomeViewModel(req) {
  const state = resolveHomeState();
  const preview = state === 'test';

  return {
    state,
    preview,
    layout: preview
      ? LAYOUTS.includes(req.query.preview)
        ? req.query.preview
        : 'registration'
      : state,
    error: req.query.error === 'true',
    createError: req.query.createError === 'true',
    thisYear,
    launchDateLabel: bracketLaunchDate.toLocaleDateString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
    currentPath: req.path,
    // Years offered in the archive lookup. Fixed window rather than a query —
    // the real list is per-group and this page must not read Firestore.
    archiveYears: Array.from({ length: 5 }, (_, i) => thisYear - i),
    ladder: buildLadder(),
    userEmail: req.session?.userEmail || null,
  };
}

// The comparison headline: one team that reaches the Final Four against three
// that each win a single game. Derived rather than written down, so hard
// numbers in the copy don't drift the first time TOURNAMENT_ROUNDS changes.
//
// Selected by round number, not by position in the array. `length - 2` happens
// to be the Final Four today and would silently become the wrong round — with
// the label to match — the first time a round is added.
function buildCompareModel(ladder) {
  const deepRun = ladder.find((r) => r.round === COMPARE_DEEP_ROUND);
  const firstRound = ladder.find((r) => r.round === COMPARE_SHALLOW_ROUND);
  const deep = deepRun ? deepRun.cumulative : 0;
  const shallow = firstRound
    ? firstRound.roundPoints * COMPARE_SHALLOW_TEAMS
    : 0;

  return {
    deep,
    shallow,
    deepLabel: deepRun ? deepRun.name : '',
    shallowTeams: COMPARE_SHALLOW_TEAMS,
    ratio: shallow ? Math.round(deep / shallow) : 0,
  };
}

const index = controllerWrapper(async (req, res) => {
  const model = buildHomeViewModel(req);

  res.render('index', {
    ...model,
    compare: buildCompareModel(model.ladder),
  });
}, 'index');

export { index, resolveHomeState };

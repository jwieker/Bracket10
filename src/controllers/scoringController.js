import { controllerWrapper } from '../utils/controllerUtils.js';
import { TOURNAMENT_ROUNDS } from '../config/app.js';
import { APP_CONFIG } from '../config/app.js';

// Builds the per-round scoring rows straight from TOURNAMENT_ROUNDS so this page
// stays the single source of truth alongside config/const.js — if the point
// schedule ever changes, the explainer updates with it automatically.
function buildScoringRows() {
  const rows = [];
  let prevRoundPoints = null;

  // Rounds 1..6 are the scoring rounds. Round 0 (First Four) awards nothing and
  // is called out separately in the view.
  for (let round = 1; round <= 6; round++) {
    const cfg = TOURNAMENT_ROUNDS[round];
    if (!cfg) continue;

    rows.push({
      round,
      name: cfg.name,
      roundPoints: cfg.roundPoints, // points earned for winning a game in this round
      cumulative: cfg.points, // total points a team has earned by reaching this round
      // The design rule: each round is worth (2 × the previous) − 1.
      doubleMinusOne: prevRoundPoints === null ? null : 2 * prevRoundPoints - 1,
      prevRoundPoints,
    });
    prevRoundPoints = cfg.roundPoints;
  }
  return rows;
}

// Alternative point schedules, for the "other ways to score" comparison. `points`
// is the value of a win in rounds 1..6. `key` is matched against FIELD_TOP5 below.
const SCHEMES = [
  {
    key: 'flat',
    name: 'Flat — count the wins',
    points: [1, 1, 1, 1, 1, 1],
    tagline: 'Every win is worth exactly one point.',
    body:
      "The simplest rule: whoever's teams win the most games wins. It's easy to " +
      'explain, but a national champion (6 wins) is worth the same as six teams ' +
      'that each win a single opening game. Depth counts for nothing, and the ' +
      'standings bunch up into a wall of ties.',
  },
  {
    key: 'linear',
    name: 'Linear',
    points: [1, 2, 3, 4, 5, 6],
    tagline: 'Each round is worth one point more than the last.',
    body:
      'A gentle ramp — a title-game win (6) is worth six times a first-round win. ' +
      'Depth matters a little, but not much: a pile of early wins still easily ' +
      'out-earns one team that goes the distance. Smooth, but it barely rewards ' +
      'the hard part of the bracket.',
  },
  {
    key: 'fibonacci',
    name: 'Fibonacci',
    points: [2, 3, 5, 8, 13, 21],
    tagline: 'Each round is the sum of the previous two.',
    body:
      'An accelerating curve that grows faster than linear but slower than ' +
      'doubling. It rewards deep runs handsomely while keeping early rounds in ' +
      'play. Close in spirit to ours — the difference is mostly how aggressively ' +
      'the late rounds pull away.',
  },
  {
    key: 'current',
    name: 'Double, minus one',
    points: [2, 3, 5, 9, 17, 33],
    tagline: 'Nearly doubles each round — but the −1 keeps early wins alive.',
    body:
      'Our rule: roundPoints(n) = 2 × the previous − 1 = 2ⁿ⁻¹ + 1. Deep runs are ' +
      'richly rewarded, so spotting a team that can run pays off — yet the −1 stops ' +
      'the curve from running away, so a wall of early wins still keeps you in it ' +
      'and breaks ties. The sweet spot between flat and pure doubling.',
    current: true,
  },
  {
    key: 'doubling',
    name: 'Pure doubling',
    points: [2, 4, 8, 16, 32, 64],
    tagline: 'Each round is worth exactly twice the last.',
    body:
      'The title game alone (64) is worth more than every earlier round for that ' +
      "team combined (62). Whoever owns the champion almost can't lose — and if " +
      "your title pick falls early, you're out of it before the second weekend. " +
      'Thrilling, but it turns the pool into a single coin-flip on the champion.',
  },
];

// The top 5 of the 2026 field, with how each entry would have scored — and placed —
// under every scheme. Computed once from the final 2026 results (databasebackup/
// Apr22-2026_2026_*.json): for each pick, rounds won → summed under each schedule.
// The 2026 tournament is final, so this is fixed historical data; embedding it
// avoids any live Firestore reads on a public page (the $0 cost contract).
const FIELD_TOP5 = [
  {
    name: 'Best Picks',
    scores: {
      flat: 25,
      linear: 63,
      fibonacci: 130,
      current: 153,
      doubling: 256,
    },
    ranks: { flat: 1, linear: 1, fibonacci: 1, current: 1, doubling: 1 },
  },
  {
    name: 'Gone Fishing',
    scores: {
      flat: 20,
      linear: 53,
      fibonacci: 113,
      current: 136,
      doubling: 232,
    },
    ranks: { flat: 5, linear: 2, fibonacci: 2, current: 2, doubling: 2 },
  },
  {
    name: 'Never in the Money',
    scores: {
      flat: 18,
      linear: 48,
      fibonacci: 103,
      current: 125,
      doubling: 214,
    },
    ranks: { flat: 16, linear: 3, fibonacci: 3, current: 3, doubling: 3 },
  },
  {
    name: 'Nothing but Net',
    scores: {
      flat: 15,
      linear: 40,
      fibonacci: 91,
      current: 113,
      doubling: 196,
    },
    ranks: { flat: 34, linear: 11, fibonacci: 5, current: 4, doubling: 4 },
  },
  {
    name: 'Go Terps',
    scores: {
      flat: 21,
      linear: 46,
      fibonacci: 94,
      current: 111,
      doubling: 180,
    },
    ranks: { flat: 2, linear: 5, fibonacci: 4, current: 5, doubling: 5 },
  },
];

// For each scheme, returns the five entries ordered by that scheme's score
// (so chart bars descend), with the max score for bar scaling.
function buildSchemeChart(schemeKey) {
  const entries = FIELD_TOP5.map((e) => ({
    name: e.name,
    score: e.scores[schemeKey],
    rank: e.ranks[schemeKey],
  })).sort((a, b) => b.score - a.score);
  const max = entries.reduce((m, e) => Math.max(m, e.score), 0);
  return { entries, max };
}

const scoring = controllerWrapper(async (req, res) => {
  // Render our scheme first so it acts as the frame of reference for the rest.
  const orderedSchemes = [...SCHEMES].sort(
    (a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0),
  );

  res.render('scoring', {
    rows: buildScoringRows(),
    maxPicks: APP_CONFIG.tournament.maxPicksPerEntry,
    schemes: orderedSchemes.map((s) => ({
      ...s,
      chart: buildSchemeChart(s.key),
    })),
  });
}, 'scoring');

export { scoring };

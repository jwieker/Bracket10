export const TOURNAMENT_ROUNDS = {
  0: { roundPoints: 0, points: 0, loserPoints: 0, wins: 0, name: "First Four" },
  1: {
    roundPoints: 2,
    points: 2,
    loserPoints: 0,
    wins: 1,
    name: "First Round",
  },
  2: {
    roundPoints: 3,
    points: 5,
    loserPoints: 2,
    wins: 2,
    name: "Second Round",
  },
  3: { roundPoints: 5, points: 10, loserPoints: 5, wins: 3, name: "Sweet 16" },
  4: { roundPoints: 9, points: 19, loserPoints: 10, wins: 4, name: "Elite 8" },
  5: {
    roundPoints: 17,
    points: 36,
    loserPoints: 19,
    wins: 5,
    name: "Final Four",
  },
  6: {
    roundPoints: 33,
    points: 69,
    loserPoints: 36,
    wins: 6,
    name: "Championship",
  },
};

export const regionMap = {
  1: "East",
  2: "West",
  3: "South",
  4: "Midwest",
  5: "Final Four",
  6: "Championship",
  7: "First Four",
};

import {
  updateWinner,
  undoGame,
  releaseGameHold,
  triggerEspnPoll,
} from '../src/controllers/gameController';
import { GameRepository } from '../src/repositories/hierarchicalRepository.js';
import {
  updateTeamRecords,
  undoTeamRecords,
  runEspnPoll,
  updatePointsForAffectedEntries,
} from '../src/services/index.js';
import { APP_CONFIG } from '../src/config/app.js';
import { ValidationError } from '../src/utils/errors.js';

// Mock the dependencies. The controller imports everything through
// services/index.js, so mock that module directly with the four names it uses.
vi.mock('../src/repositories/hierarchicalRepository.js');
vi.mock('../src/services/index.js', () => ({
  updateTeamRecords: vi.fn(),
  undoTeamRecords: vi.fn(),
  runEspnPoll: vi.fn(),
  updatePointsForAffectedEntries: vi.fn().mockResolvedValue(),
}));

// Create a single mock instance that will be shared
const mockGameRepository = {
  updateWinner: vi.fn(),
  updateNextGameTeam: vi.fn(),
  setGameManualHold: vi.fn(),
};

// Mock the GameRepository class implementation
GameRepository.mockImplementation(() => mockGameRepository);

// Mock the singleton instance that the controller uses
vi.spyOn(GameRepository.prototype, 'updateWinner').mockImplementation(
  mockGameRepository.updateWinner,
);
vi.spyOn(GameRepository.prototype, 'updateNextGameTeam').mockImplementation(
  mockGameRepository.updateNextGameTeam,
);
vi.spyOn(GameRepository.prototype, 'setGameManualHold').mockImplementation(
  mockGameRepository.setGameManualHold,
);

describe('updateWinner', () => {
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      body: {
        gameID: '23',
        winnerID: '1',
        nextGameID: '43',
        nextGameSpot: '1',
        round: '2',
        team1ID: '1',
        team2ID: '2',
        year: '2024',
      },
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  test('updateWinner should successfully update game winner', async () => {
    // Setup successful repository calls
    mockGameRepository.updateWinner.mockResolvedValue();
    mockGameRepository.updateNextGameTeam.mockResolvedValue();
    updateTeamRecords.mockResolvedValue();

    await updateWinner(mockRequest, mockResponse);

    // winnerID ("1") == team1ID ("1"), so the loser is team2ID (2). The repo
    // methods (updateWinner/updateNextGameTeam) are exercised inside the mocked
    // updateTeamRecords service, so we assert the loser-resolution here.
    expect(updateTeamRecords).toHaveBeenCalledWith(
      Number(mockRequest.body.winnerID),
      Number(mockRequest.body.team2ID),
      Number(mockRequest.body.round),
      Number(mockRequest.body.gameID),
      Number(mockRequest.body.nextGameID),
      Number(mockRequest.body.nextGameSpot),
      Number(mockRequest.body.year),
    );

    // #369: only the entries holding either team are recomputed — never the
    // full-year updatePossiblePoints path.
    expect(updatePointsForAffectedEntries).toHaveBeenCalledWith(2024, [1, 2]);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: 'Game result updated successfully',
    });
  });

  test('updateWinner resolves the loser as team1ID when the winner is team2', async () => {
    // The previously-uncovered branch: winner != team1ID, so loser stays team1ID.
    mockGameRepository.updateWinner.mockResolvedValue();
    mockGameRepository.updateNextGameTeam.mockResolvedValue();
    updateTeamRecords.mockResolvedValue();

    mockRequest.body.winnerID = '2'; // team2 wins → loser is team1ID (1)

    await updateWinner(mockRequest, mockResponse);

    expect(updateTeamRecords).toHaveBeenCalledWith(
      2, // winner
      Number(mockRequest.body.team1ID), // loser
      Number(mockRequest.body.round),
      Number(mockRequest.body.gameID),
      Number(mockRequest.body.nextGameID),
      Number(mockRequest.body.nextGameSpot),
      Number(mockRequest.body.year),
    );

    expect(updatePointsForAffectedEntries).toHaveBeenCalledWith(2024, [2, 1]);

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: 'Game result updated successfully',
    });
  });

  test('returns 500 (not a success) when the points recalc fails (#259)', async () => {
    mockGameRepository.updateWinner.mockResolvedValue();
    mockGameRepository.updateNextGameTeam.mockResolvedValue();
    updateTeamRecords.mockResolvedValue();
    // The recalc throws — the admin must NOT be told the result was updated.
    updatePointsForAffectedEntries.mockRejectedValueOnce(
      new Error('recalc failed'),
    );

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.status).not.toHaveBeenCalledWith(200);
    expect(mockResponse.json).not.toHaveBeenCalledWith({
      message: 'Game result updated successfully',
    });
  });

  // #425: these are the admin's manual result-entry endpoints — bad input
  // must 400 before ANY service call. A NaN winnerID used to be written into
  // the game doc and the next round's slot (where the poll could never repair
  // it), and a winnerID matching neither team silently advanced a team that
  // never played.
  test('returns 400 for a missing winnerID without calling any service (#425)', async () => {
    delete mockRequest.body.winnerID;

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('returns 400 when winnerID matches neither team (#425)', async () => {
    mockRequest.body.team1ID = '28';
    mockRequest.body.team2ID = '73';
    mockRequest.body.winnerID = '999';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('returns 400 when team1ID equals team2ID (#425)', async () => {
    // winnerID matches both, so this pins the dedicated same-team guard
    // rather than the winner-must-be-a-participant check.
    mockRequest.body.team1ID = '5';
    mockRequest.body.team2ID = '5';
    mockRequest.body.winnerID = '5';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric gameID (#425)', async () => {
    mockRequest.body.gameID = 'abc';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric nextGameID (#425)', async () => {
    mockRequest.body.nextGameID = 'abc';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid year (#425)', async () => {
    mockRequest.body.year = 'not-a-year';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
  });

  test('returns 400 for an unknown round (#425)', async () => {
    mockRequest.body.round = '7';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
  });

  test('returns 400 for an out-of-range nextGameSpot when nextGameID is set (#425)', async () => {
    mockRequest.body.nextGameSpot = '3';

    await updateWinner(mockRequest, mockResponse);

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(updateTeamRecords).not.toHaveBeenCalled();
  });

  // The two legitimate edge shapes validation must NOT reject:
  test('accepts a First Four game (round 0) (#425)', async () => {
    updateTeamRecords.mockResolvedValue();
    mockRequest.body.round = '0';

    await updateWinner(mockRequest, mockResponse);

    expect(updateTeamRecords).toHaveBeenCalledWith(1, 2, 0, 23, 43, 1, 2024);
    expect(mockResponse.status).toHaveBeenCalledWith(200);
  });

  test('accepts the championship game (no next game) and normalizes to null (#425)', async () => {
    updateTeamRecords.mockResolvedValue();
    // The championship game doc carries nextGameID 0 / nextGameSpot null,
    // which the admin client submits as '0' (table view) or '' (poll view).
    for (const emptyNext of ['0', '']) {
      vi.clearAllMocks();
      mockRequest.body.round = '6';
      mockRequest.body.nextGameID = emptyNext;
      mockRequest.body.nextGameSpot = '';

      await updateWinner(mockRequest, mockResponse);

      expect(updateTeamRecords).toHaveBeenCalledWith(
        1,
        2,
        6,
        23,
        null,
        null,
        2024,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    }
  });
});

describe('undoGame', () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {
        gameID: '23',
        winnerID: '1',
        nextGameID: '43',
        nextGameSpot: '1',
        round: '2',
        team1ID: '1',
        team2ID: '2',
        year: '2024',
      },
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    mockGameRepository.updateWinner.mockResolvedValue();
    mockGameRepository.updateNextGameTeam.mockResolvedValue();
    undoTeamRecords.mockResolvedValue();
  });

  test('should successfully undo a game', async () => {
    await undoGame(mockReq, mockRes);

    //        expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(23, null);
    //        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(43, 1, null);
    expect(undoTeamRecords).toHaveBeenCalledWith(1, 2, 2, 23, 43, 1, 2024, 1);

    // #369: undo also uses the targeted recompute for the two affected teams.
    expect(updatePointsForAffectedEntries).toHaveBeenCalledWith(2024, [1, 2]);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: 'Game result updated successfully',
    });
  });

  test('returns 500 (not a success) when the points recalc fails (#259)', async () => {
    // Mirror of updateWinner's failure-path test: a recalc error must reject
    // through controllerWrapper, not report "updated successfully" while
    // standings are silently stale.
    updatePointsForAffectedEntries.mockRejectedValueOnce(
      new Error('recalc failed'),
    );

    await undoGame(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.status).not.toHaveBeenCalledWith(200);
    expect(mockRes.json).not.toHaveBeenCalledWith({
      message: 'Game result updated successfully',
    });
  });

  // #425: undoGame shares parseGameResultPayload with updateWinner — pin the
  // same reject-before-any-write behavior on this endpoint too.
  test('returns 400 for a non-numeric winnerID without calling any service (#425)', async () => {
    mockReq.body.winnerID = 'abc';

    await undoGame(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(undoTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('returns 400 when winnerID matches neither team (#425)', async () => {
    mockReq.body.winnerID = '999';

    await undoGame(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(undoTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('returns 400 when team1ID equals team2ID (#425)', async () => {
    mockReq.body.team1ID = '5';
    mockReq.body.team2ID = '5';
    mockReq.body.winnerID = '5';

    await undoGame(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(undoTeamRecords).not.toHaveBeenCalled();
    expect(updatePointsForAffectedEntries).not.toHaveBeenCalled();
  });

  test('passes team1ID through for a round-0 (First Four) undo (#425)', async () => {
    // undoTeamRecords needs the payload's team1ID on the round-0 path to pick
    // the normalize-to-combined branch (see gameService.js) — pin that the
    // controller still forwards it after validation.
    mockReq.body.round = '0';

    await undoGame(mockReq, mockRes);

    expect(undoTeamRecords).toHaveBeenCalledWith(1, 2, 0, 23, 43, 1, 2024, 1);
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });
});

describe('releaseGameHold', () => {
  let mockRes;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  test('clears the hold for a valid gameID/year and returns 200', async () => {
    mockGameRepository.setGameManualHold.mockResolvedValue();
    const req = {
      body: { gameID: '64', year: '2024' },
      method: 'POST',
      url: '/releaseGameHold',
    };

    await releaseGameHold(req, mockRes);

    expect(mockGameRepository.setGameManualHold).toHaveBeenCalledWith(
      64,
      false,
      2024,
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/hold released/i),
      }),
    );
  });

  test('returns 400 for missing or non-positive gameID without touching the repo', async () => {
    for (const gameID of [undefined, '0', '-3', 'abc']) {
      const req = {
        body: { gameID, year: '2024' },
        method: 'POST',
        url: '/releaseGameHold',
      };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      await releaseGameHold(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mockGameRepository.setGameManualHold).not.toHaveBeenCalled();
  });

  test('returns 400 for a missing year without touching the repo', async () => {
    const req = {
      body: { gameID: '64' },
      method: 'POST',
      url: '/releaseGameHold',
    };

    await releaseGameHold(req, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockGameRepository.setGameManualHold).not.toHaveBeenCalled();
  });
});

describe('triggerEspnPoll', () => {
  let mockRes;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  // The entire safety model of the admin "trigger poll" preview button is that
  // it never writes — that guarantee lives in the one-character `dryRun: true`
  // literal at the call site, which no test previously exercised (#435).
  test('always calls runEspnPoll with dryRun: true, defaulting dateStr to null', async () => {
    const summary = { updated: 0, skipped: 0 };
    runEspnPoll.mockResolvedValue(summary);
    const req = { body: {}, method: 'POST', url: '/triggerEspnPoll' };

    await triggerEspnPoll(req, mockRes);

    expect(runEspnPoll).toHaveBeenCalledWith(
      APP_CONFIG.tournament.currentYear,
      { dryRun: true, dateStr: null },
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(summary);
  });

  test('passes an explicit dateStr through to runEspnPoll', async () => {
    const summary = { updated: 1, skipped: 0 };
    runEspnPoll.mockResolvedValue(summary);
    const req = {
      body: { dateStr: '20260318' },
      method: 'POST',
      url: '/triggerEspnPoll',
    };

    await triggerEspnPoll(req, mockRes);

    expect(runEspnPoll).toHaveBeenCalledWith(
      APP_CONFIG.tournament.currentYear,
      { dryRun: true, dateStr: '20260318' },
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(summary);
  });

  test('returns 400 and no summary when the service rejects an invalid dateStr', async () => {
    runEspnPoll.mockRejectedValue(
      new ValidationError('Invalid ESPN date format (expected YYYYMMDD)'),
    );
    const req = {
      body: { dateStr: '2026-03-18' },
      method: 'POST',
      url: '/triggerEspnPoll',
    };

    await triggerEspnPoll(req, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.status).not.toHaveBeenCalledWith(200);
    expect(mockRes.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ updated: expect.anything() }),
    );
  });
});

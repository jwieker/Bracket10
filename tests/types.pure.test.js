import { describe, it, expect } from 'vitest';
import { Types } from '../src/types/index.js';

describe('Types Export', () => {
  it('should export the Types object', () => {
    expect(Types).toBeDefined();
    expect(typeof Types).toBe('object');
  });

  it('should contain all expected properties with correct string values', () => {
    const expectedTypes = {
      TournamentRound: 'TournamentRound',
      Team: 'Team',
      Game: 'Game',
      Entry: 'Entry',
      GroupTeam: 'GroupTeam',
      PointsCalculation: 'PointsCalculation',
      TournamentData: 'TournamentData',
    };

    expect(Types).toEqual(expectedTypes);
  });

  it('should not contain any unexpected properties', () => {
    const expectedKeys = [
      'TournamentRound',
      'Team',
      'Game',
      'Entry',
      'GroupTeam',
      'PointsCalculation',
      'TournamentData',
    ];

    expect(Object.keys(Types).sort()).toEqual(expectedKeys.sort());
  });
});

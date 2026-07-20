// Centralized repository management — exports the hierarchical implementation directly
import * as repos from './hierarchicalRepository.js';

// Plain singleton exports. The former RepositoryManager class used lazy getters but then
// immediately destructured them at module load, defeating the laziness (issue #293).
// Constructors are cheap (no I/O), so direct exports are cleaner and equally correct.
export const entryRepository = new repos.EntryRepository();
export const viewRepository = new repos.ViewRepository();
export const gameRepository = new repos.GameRepository();
export const tourneyRepository = new repos.TourneyRepository();
export const teamRepository = new repos.TeamRepository();
export const conferenceRepository = new repos.ConferenceRepository();
export const sessionRepository = new repos.SessionRepository();

// Export classes
export const {
  EntryRepository,
  ViewRepository,
  GameRepository,
  TourneyRepository,
  TeamRepository,
  ConferenceRepository,
  SessionRepository,
} = repos;

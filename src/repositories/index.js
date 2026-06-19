// Centralized repository management — exports the hierarchical implementation directly
import * as repos from './hierarchicalRepository.js';

// Singleton repository instances
class RepositoryManager {
    constructor() {
        this._entryRepository = null;
        this._viewRepository = null;
        this._gameRepository = null;
        this._tourneyRepository = null;
        this._teamRepository = null;
        this._conferenceRepository = null;
        this._sessionRepository = null;
    }

    get entryRepository() {
        if (!this._entryRepository) {
            this._entryRepository = new repos.EntryRepository();
        }
        return this._entryRepository;
    }

    get viewRepository() {
        if (!this._viewRepository) {
            this._viewRepository = new repos.ViewRepository();
        }
        return this._viewRepository;
    }

    get gameRepository() {
        if (!this._gameRepository) {
            this._gameRepository = new repos.GameRepository();
        }
        return this._gameRepository;
    }

    get tourneyRepository() {
        if (!this._tourneyRepository) {
            this._tourneyRepository = new repos.TourneyRepository();
        }
        return this._tourneyRepository;
    }

    get teamRepository() {
        if (!this._teamRepository) {
            this._teamRepository = new repos.TeamRepository();
        }
        return this._teamRepository;
    }

    get conferenceRepository() {
        if (!this._conferenceRepository) {
            this._conferenceRepository = new repos.ConferenceRepository();
        }
        return this._conferenceRepository;
    }

    get sessionRepository() {
        if (!this._sessionRepository) {
            this._sessionRepository = new repos.SessionRepository();
        }
        return this._sessionRepository;
    }

    // Method to set repositories (for testing)
    setRepositories(repositories) {
        this._entryRepository = repositories.entryRepository;
        this._viewRepository = repositories.viewRepository;
        this._gameRepository = repositories.gameRepository;
        this._tourneyRepository = repositories.tourneyRepository;
        this._teamRepository = repositories.teamRepository;
        this._conferenceRepository = repositories.conferenceRepository;
        this._sessionRepository = repositories.sessionRepository;
    }
}

// Export singleton instance
export const repositoryManager = new RepositoryManager();

// Export individual repositories for convenience
export const {
    entryRepository,
    viewRepository,
    gameRepository,
    tourneyRepository,
    teamRepository,
    conferenceRepository,
    sessionRepository,
} = repositoryManager;

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

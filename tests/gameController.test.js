import { updateWinner, undoGame } from "../src/controllers/gameController";
import { GameRepository } from "../src/repositories/hierarchicalRepository.js";
import {
  updateTeamRecords,
  undoTeamRecords,
} from "../src/services/gameService";

// Mock the dependencies
vi.mock("../src/repositories/hierarchicalRepository.js");
vi.mock("../src/services/gameService");
vi.mock("../src/controllers/pointsController", () => ({
  updateTotalPointsJustYear: vi.fn().mockResolvedValue(),
}));

// Create a single mock instance that will be shared
const mockGameRepository = {
  updateWinner: vi.fn(),
  updateNextGameTeam: vi.fn(),
};

// Mock the GameRepository class implementation
GameRepository.mockImplementation(() => mockGameRepository);

// Mock the singleton instance that the controller uses
vi
  .spyOn(GameRepository.prototype, "updateWinner")
  .mockImplementation(mockGameRepository.updateWinner);
vi
  .spyOn(GameRepository.prototype, "updateNextGameTeam")
  .mockImplementation(mockGameRepository.updateNextGameTeam);

describe("updateWinner", () => {
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      body: {
        gameID: "23",
        winnerID: "1",
        nextGameID: "43",
        nextGameSpot: "1",
        round: "2",
        team1ID: "1",
        team2ID: "2",
        year: "2024",
      },
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  });

  test("updateWinner should successfully update game winner", async () => {
    // Setup successful repository calls
    mockGameRepository.updateWinner.mockResolvedValue();
    mockGameRepository.updateNextGameTeam.mockResolvedValue();
    updateTeamRecords.mockResolvedValue();

    await updateWinner(mockRequest, mockResponse);

    // Verify repository calls were made with correct parameters
    // expect(mockGameRepository.updateWinner)
    //     .toHaveBeenCalledWith(Number(mockRequest.body.gameID), Number(mockRequest.body.winnerID));
    // expect(mockGameRepository.updateNextGameTeam)
    //     .toHaveBeenCalledWith(Number(mockRequest.body.nextGameID), Number(mockRequest.body.nextGameSpot), Number(mockRequest.body.winnerID));
    expect(updateTeamRecords).toHaveBeenCalledWith(
      Number(mockRequest.body.winnerID),
      Number(mockRequest.body.team2ID),
      Number(mockRequest.body.round),
      Number(mockRequest.body.gameID),
      Number(mockRequest.body.nextGameID),
      Number(mockRequest.body.nextGameSpot),
      Number(mockRequest.body.year)
    );

    expect(mockResponse.status).toHaveBeenCalledWith(200);
    expect(mockResponse.json).toHaveBeenCalledWith({
      message: "Game result updated successfully",
    });
  });
});

describe("undoGame", () => {
  let mockReq;
  let mockRes;

  beforeEach(() => {
    vi.clearAllMocks();

    mockReq = {
      body: {
        gameID: "23",
        winnerID: "1",
        nextGameID: "43",
        nextGameSpot: "1",
        round: "2",
        team1ID: "1",
        team2ID: "2",
        year: "2024",
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

  test("should successfully undo a game", async () => {
    await undoGame(mockReq, mockRes);

    //        expect(mockGameRepository.updateWinner).toHaveBeenCalledWith(23, null);
    //        expect(mockGameRepository.updateNextGameTeam).toHaveBeenCalledWith(43, 1, null);
    expect(undoTeamRecords).toHaveBeenCalledWith(1, 2, 2, 23, 43, 1, 2024, 1);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Game result updated successfully",
    });
  });
});

import { vi, expect, test, describe, afterEach } from "vitest";

// Mock module.createRequire to throw an error
vi.mock("module", () => {
  return {
    createRequire: () => () => {
      throw new Error("Cannot find module");
    }
  };
});

import { loadTeamMap } from "../src/services/espnService.js";
import Logger from "../src/utils/logger.js";

describe("loadTeamMap error path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns {} and logs warn when require throws", () => {
    const loggerSpy = vi.spyOn(Logger, "warn").mockImplementation(() => {});

    const result = loadTeamMap();

    expect(result).toEqual({});
    expect(loggerSpy).toHaveBeenCalledWith(
      "ESPN poll: espnTeamMap.json not found or invalid — no games will be matched"
    );
  });
});

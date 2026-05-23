import { getGoogleClientId, getOAuthClient, getRedirectUri, getAuthUrl, isAdminEmail } from "../src/config/auth.js";

const { generateAuthUrlMock } = vi.hoisted(() => ({
  generateAuthUrlMock: vi.fn(),
}));

vi.mock("google-auth-library", () => {
  return {
    OAuth2Client: vi.fn().mockImplementation(function(clientId, clientSecret, redirectUri) {
      return {
        generateAuthUrl: generateAuthUrlMock,
        clientId,
        clientSecret,
        redirectUri,
      };
    }),
  };
});

describe("auth.js utility functions", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("getGoogleClientId returns GOOGLE_CLIENT_ID from process.env", () => {
    process.env.GOOGLE_CLIENT_ID = "mock-client-id";
    expect(getGoogleClientId()).toBe("mock-client-id");
  });

  test("getRedirectUri prefers REDIRECT_URI when set, regardless of NODE_ENV or APP_HOST", () => {
    process.env.REDIRECT_URI = "https://tunnel.example.com/auth/google/callback";
    process.env.NODE_ENV = "development";
    process.env.APP_HOST = "ignored.example.com";
    expect(getRedirectUri()).toBe("https://tunnel.example.com/auth/google/callback");
  });

  test("getRedirectUri returns production callback using APP_HOST when NODE_ENV is production", () => {
    process.env.NODE_ENV = "production";
    process.env.APP_HOST = "example.com";
    expect(getRedirectUri()).toBe("https://example.com/auth/google/callback");
  });

  test("getRedirectUri falls back to localhost in production when APP_HOST is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_HOST;
    process.env.PORT = "8080";
    expect(getRedirectUri()).toBe("http://localhost:8080/auth/google/callback");
  });

  test("getRedirectUri returns localhost callback using PORT if NODE_ENV is not production", () => {
    process.env.NODE_ENV = "development";
    process.env.PORT = "3000";
    expect(getRedirectUri()).toBe("http://localhost:3000/auth/google/callback");

    delete process.env.PORT;
    expect(getRedirectUri()).toBe("http://localhost:8080/auth/google/callback");
  });

  test("getOAuthClient creates a client lazily and caches it", () => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "sec";
    process.env.PORT = "8080";

    const client1 = getOAuthClient();
    expect(client1.clientId).toBe("cid");
    expect(client1.clientSecret).toBe("sec");
    expect(client1.redirectUri).toBe("http://localhost:8080/auth/google/callback");

    const client2 = getOAuthClient();
    expect(client2).toBe(client1); // returns cached instance
  });

  test("getAuthUrl calls generateAuthUrl on the OAuthClient", () => {
    generateAuthUrlMock.mockReturnValue("https://google-auth-url-stub");
    const state = "xyz";
    const url = getAuthUrl(state);

    expect(generateAuthUrlMock).toHaveBeenCalledWith({
      access_type: "online",
      scope: ["email", "profile"],
      prompt: "select_account",
      state,
    });
    expect(url).toBe("https://google-auth-url-stub");
  });

  test("isAdminEmail handles various cases", () => {
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail("")).toBe(false);

    process.env.ADMIN_EMAILS = "Admin@Example.Com,  test@domain.com  ";

    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("ADMIN@EXAMPLE.COM")).toBe(true);
    expect(isAdminEmail("test@domain.com")).toBe(true);
    expect(isAdminEmail("other@domain.com")).toBe(false);
  });
});

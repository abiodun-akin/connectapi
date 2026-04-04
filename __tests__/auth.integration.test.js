const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "signed-token"),
  decode: jest.fn(),
  verify: jest.fn(),
}));

jest.mock("../user", () => ({
  findById: jest.fn(),
  signup: jest.fn(),
  login: jest.fn(),
  generateRecoveryCodes: jest.fn(() => [
    "CODE1111",
    "CODE2222",
    "CODE3333",
    "CODE4444",
    "CODE5555",
    "CODE6666",
    "CODE7777",
    "CODE8888",
    "CODE9999",
    "CODE0000",
  ]),
}));

jest.mock("../subscription", () => ({
  findOne: jest.fn(),
  createTrialSubscription: jest.fn(),
}));

jest.mock("../promoCode", () => ({
  getRedeemableCode: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));

jest.mock("../agentLedger", () => ({
  create: jest.fn(),
}));

jest.mock("../userProfile", () => ({
  findOne: jest.fn(),
}));

jest.mock("axios", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

jest.mock("../middleware/eventNotification", () => ({
  publishEvent: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const User = require("../user");
const UserProfile = require("../userProfile");
const { publishEvent } = require("../middleware/eventNotification");
const authRoutes = require("../routes/auth");
const errorHandler = require("../middleware/errorHandler");

describe("Auth Routes Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    UserProfile.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/auth", authRoutes);
    app.use(errorHandler);
  });

  it("publishes logout event with resolved recipient email from the auth cookie", async () => {
    jwt.decode.mockReturnValue({ id: "user-123" });
    const lean = jest
      .fn()
      .mockResolvedValue({ _id: "user-123", email: "user@example.com" });
    const select = jest.fn().mockReturnValue({ lean });
    User.findById.mockReturnValue({ select });

    const response = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", ["jwt=mock-token"]);

    expect(response.status).toBe(200);
    expect(publishEvent).toHaveBeenCalledWith(
      "auth_events",
      "auth.logout",
      expect.objectContaining({
        userId: "user-123",
        email: "user@example.com",
      }),
    );
  });

  it("returns the current authenticated session from cookie-backed auth", async () => {
    jwt.verify.mockReturnValue({ id: "user-456" });
    User.findById.mockResolvedValue({
      _id: "user-456",
      name: "Farm Connect User",
      email: "session@example.com",
      isAdmin: false,
      isSuspended: false,
      isAgent: false,
      agentStatus: "none",
      googleId: null,
      microsoftId: null,
    });

    const response = await request(app)
      .get("/api/auth/session")
      .set("Cookie", ["jwt=signed-token"]);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual(
      expect.objectContaining({
        email: "session@example.com",
        authProvider: "local",
      }),
    );
    expect(response.body.token).toBe("signed-token");
  });

  it("refreshes session from cookie token and rotates auth token", async () => {
    const now = Math.floor(Date.now() / 1000);
    jwt.verify.mockReturnValue({
      id: "user-789",
      iat: now - 120,
      exp: now - 30,
    });
    User.findById.mockResolvedValue({
      _id: "user-789",
      name: "Refresh User",
      email: "refresh@example.com",
      isEmailVerified: true,
      isAdmin: false,
      isSuspended: false,
      isAgent: false,
      agentStatus: "none",
      googleId: null,
      microsoftId: null,
      passwordChangedAt: null,
    });

    const response = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", ["jwt=expired-token"]);

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/session refreshed/i);
    expect(response.body.token).toBe("signed-token");
    expect(publishEvent).toHaveBeenCalledWith(
      "auth_events",
      "auth.refresh",
      expect.objectContaining({
        userId: "user-789",
        email: "refresh@example.com",
      }),
    );
  });

  it("returns 401 on refresh when no auth token is provided", async () => {
    const response = await request(app).post("/api/auth/refresh");
    expect(response.status).toBe(401);
  });

  it("returns 202 with challenge token when login requires 2FA", async () => {
    User.login.mockResolvedValue({
      _id: "user-2fa",
      email: "2fa@example.com",
      name: "Two Factor User",
      twoFactorEnabled: true,
      save: jest.fn().mockResolvedValue(true),
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: "2fa@example.com", password: "StrongPass1" });

    expect(response.status).toBe(202);
    expect(response.body.requiresTwoFactor).toBe(true);
    expect(response.body.challengeToken).toBe("signed-token");
  });

  it("verifies 2FA challenge and returns authenticated session", async () => {
    jwt.verify.mockReturnValue({ id: "user-2fa", purpose: "two-factor" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: "user-2fa",
        email: "2fa@example.com",
        name: "Two Factor User",
        twoFactorEnabled: true,
        twoFactorCodeHash:
          "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",
        twoFactorCodeExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        twoFactorAttemptCount: 0,
        isAdmin: false,
        isSuspended: false,
        isAgent: false,
        agentStatus: "none",
        googleId: null,
        microsoftId: null,
        save: jest.fn().mockResolvedValue(true),
      }),
    });

    const response = await request(app)
      .post("/api/auth/2fa/verify")
      .send({ challengeToken: "challenge-token", code: "123456" });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe("signed-token");
    expect(response.body.user.email).toBe("2fa@example.com");
  });

  it("enables 2FA for authenticated user", async () => {
    jwt.verify.mockReturnValue({ id: "user-enable-2fa" });
    User.findById.mockResolvedValue({
      _id: "user-enable-2fa",
      email: "enable@example.com",
      twoFactorEnabled: false,
      setRecoveryCodes: jest.fn(),
      save: jest.fn().mockResolvedValue(true),
    });

    const response = await request(app)
      .post("/api/auth/2fa/enable")
      .set("Cookie", ["jwt=signed-token"]);

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/enabled/i);
  });

  it("disables 2FA for authenticated user", async () => {
    jwt.verify.mockReturnValue({ id: "user-disable-2fa" });
    User.findById.mockResolvedValue({
      _id: "user-disable-2fa",
      email: "disable@example.com",
      twoFactorEnabled: true,
      save: jest.fn().mockResolvedValue(true),
    });

    const response = await request(app)
      .post("/api/auth/2fa/disable")
      .set("Cookie", ["jwt=signed-token"]);

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/disabled/i);
  });
});

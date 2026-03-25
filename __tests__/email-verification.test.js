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
  findOne: jest.fn(),
  signup: jest.fn(),
  login: jest.fn(),
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
const { publishEvent } = require("../middleware/eventNotification");
const authRoutes = require("../routes/auth");
const errorHandler = require("../middleware/errorHandler");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/auth", authRoutes);
  app.use(errorHandler);
  return app;
};

const makeAuthenticatedUser = (overrides = {}) => ({
  _id: "user-123",
  email: "farmer@example.com",
  name: "Test Farmer",
  isEmailVerified: false,
  emailVerificationLastSentAt: null,
  isSuspended: false,
  passwordChangedAt: null,
  createEmailVerificationToken: jest.fn(() => "rawtoken-abc123-xyz456-1234567890abcdef"),
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe("Email Verification Endpoints", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  // ─── POST /auth/send-verification ─────────────────────────────────────────

  describe("POST /api/auth/send-verification", () => {
    it("returns 401 when no auth token is provided", async () => {
      const response = await request(app)
        .post("/api/auth/send-verification");

      expect(response.status).toBe(401);
    });

    it("returns 200 with already-verified message when user email is already verified", async () => {
      jwt.verify.mockReturnValue({ id: "user-123" });
      User.findById.mockResolvedValue(
        makeAuthenticatedUser({ isEmailVerified: true })
      );

      const response = await request(app)
        .post("/api/auth/send-verification")
        .set("Authorization", "Bearer signed-token");

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/already verified/i);
      expect(publishEvent).not.toHaveBeenCalled();
    });

    it("returns 400 with cooldown seconds remaining when resent within 2 minutes", async () => {
      jwt.verify.mockReturnValue({ id: "user-123" });
      // Set last-sent to 30 seconds ago (within 2-minute cooldown)
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      User.findById.mockResolvedValue(
        makeAuthenticatedUser({ emailVerificationLastSentAt: thirtySecondsAgo })
      );

      const response = await request(app)
        .post("/api/auth/send-verification")
        .set("Authorization", "Bearer signed-token");

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/wait/i);
      expect(response.body.error).toMatch(/seconds/i);
      expect(publishEvent).not.toHaveBeenCalled();
    });

    it("returns 200 and publishes verification event when past cooldown", async () => {
      jwt.verify.mockReturnValue({ id: "user-123" });
      // Last sent 5 minutes ago (well past the 2-minute cooldown)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const user = makeAuthenticatedUser({ emailVerificationLastSentAt: fiveMinutesAgo });
      User.findById.mockResolvedValue(user);

      const response = await request(app)
        .post("/api/auth/send-verification")
        .set("Authorization", "Bearer signed-token");

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/verification email sent/i);
      expect(user.createEmailVerificationToken).toHaveBeenCalledTimes(1);
      expect(user.save).toHaveBeenCalledTimes(1);
      expect(publishEvent).toHaveBeenCalledWith(
        "auth_events",
        "auth.email_verification_requested",
        expect.objectContaining({
          userId: "user-123",
          email: "farmer@example.com",
          name: "Test Farmer",
          expiresInHours: 24,
        })
      );
    });

    it("returns 200 and publishes event for first-time send (no prior lastSentAt)", async () => {
      jwt.verify.mockReturnValue({ id: "user-123" });
      const user = makeAuthenticatedUser({ emailVerificationLastSentAt: null });
      User.findById.mockResolvedValue(user);

      const response = await request(app)
        .post("/api/auth/send-verification")
        .set("Authorization", "Bearer signed-token");

      expect(response.status).toBe(200);
      expect(publishEvent).toHaveBeenCalledTimes(1);
    });
  });

  // ─── POST /auth/verify-email ──────────────────────────────────────────────

  describe("POST /api/auth/verify-email", () => {
    it("returns 400 when token is missing", async () => {
      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({});

      expect(response.status).toBe(400);
    });

    it("returns 400 when token is shorter than 20 characters", async () => {
      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: "short" });

      expect(response.status).toBe(400);
    });

    it("returns 400 when token hash does not match any user", async () => {
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: "a".repeat(32) });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/invalid or has expired/i);
    });

    it("returns 400 when token hash matches expired token (findOne filters expiry)", async () => {
      // Simulate expired token — findOne returns null when $gt: new Date() fails
      User.findOne.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: "b".repeat(32) });

      expect(response.status).toBe(400);
    });

    it("marks user as verified and clears token fields on valid token", async () => {
      const mockUser = {
        _id: "user-456",
        email: "verified@example.com",
        isEmailVerified: false,
        emailVerificationTokenHash: "somehash",
        emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      User.findOne.mockResolvedValue(mockUser);

      const response = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: "c".repeat(32) });

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/verified successfully/i);
      expect(mockUser.isEmailVerified).toBe(true);
      expect(mockUser.emailVerificationTokenHash).toBeNull();
      expect(mockUser.emailVerificationExpiresAt).toBeNull();
      expect(mockUser.save).toHaveBeenCalledTimes(1);
    });

    it("passes the sha256 hash of the token to findOne", async () => {
      const crypto = require("crypto");
      const rawToken = "d".repeat(32);
      const expectedHash = crypto.createHash("sha256").update(rawToken).digest("hex");

      const mockUser = {
        _id: "user-789",
        email: "hash-test@example.com",
        isEmailVerified: false,
        emailVerificationTokenHash: expectedHash,
        emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      User.findOne.mockResolvedValue(mockUser);

      await request(app)
        .post("/api/auth/verify-email")
        .send({ token: rawToken });

      expect(User.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          emailVerificationTokenHash: expectedHash,
        })
      );
    });
  });
});

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
    const lean = jest.fn().mockResolvedValue({ _id: "user-123", email: "user@example.com" });
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
      })
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
      })
    );
    expect(response.body.token).toBe("signed-token");
  });
});
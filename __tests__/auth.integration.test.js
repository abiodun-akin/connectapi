const cookieParser = require("cookie-parser");
const express = require("express");
const request = require("supertest");

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(() => "signed-token"),
  decode: jest.fn(),
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

jest.mock("../middleware/eventNotification", () => ({
  publishEvent: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const User = require("../user");
const { publishEvent } = require("../middleware/eventNotification");
const authRoutes = require("../routes/auth");
const errorHandler = require("../middleware/errorHandler");

describe("Auth Routes Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
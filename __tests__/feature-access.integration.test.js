const express = require("express");
const request = require("supertest");

jest.mock("../subscription", () => ({
  getUserActiveSubscription: jest.fn(),
  hasEverSubscribed: jest.fn(),
}));

const Subscription = require("../subscription");
const requireFeatureAccess = require("../middleware/requireFeatureAccess");
const { FEATURE_ACCESS } = require("../utils/subscriptionAccess");
const errorHandler = require("../middleware/errorHandler");

describe("Feature access route integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();

    // Simulate authenticated request context expected by requireFeatureAccess.
    app.use((req, _res, next) => {
      req.user = { _id: "user-123" };
      next();
    });

    app.get(
      "/api/messages",
      requireFeatureAccess(FEATURE_ACCESS.CORE),
      (_req, res) => res.status(200).json({ ok: true, resource: "messages" })
    );

    app.get(
      "/api/matches",
      requireFeatureAccess(FEATURE_ACCESS.CORE),
      (_req, res) => res.status(200).json({ ok: true, resource: "matches" })
    );

    app.use(errorHandler);
  });

  it("blocks /api/messages for never-subscribed users", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    Subscription.hasEverSubscribed.mockResolvedValue(false);

    const response = await request(app).get("/api/messages");

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        code: "SUBSCRIPTION_REQUIRED",
        feature: "core",
        subscriptionStatus: "never-subscribed",
        hasEverSubscribed: false,
      })
    );
  });

  it("blocks /api/matches for expired users", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const response = await request(app).get("/api/matches");

    expect(response.status).toBe(403);
    expect(response.body).toEqual(
      expect.objectContaining({
        code: "SUBSCRIPTION_REQUIRED",
        feature: "core",
        subscriptionStatus: "expired",
        hasEverSubscribed: true,
      })
    );
  });

  it("allows /api/messages for active subscribers", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-1",
      endDate: new Date(Date.now() + 60 * 60 * 1000),
    });
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const response = await request(app).get("/api/messages");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, resource: "messages" });
  });

  it("allows /api/matches for active subscribers", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-2",
      endDate: new Date(Date.now() + 60 * 60 * 1000),
    });
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const response = await request(app).get("/api/matches");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, resource: "matches" });
  });
});

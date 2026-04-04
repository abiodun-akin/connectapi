const express = require("express");
const request = require("supertest");

jest.mock("../paymentRecord", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  findById: jest.fn(),
  updatePaymentStatus: jest.fn(),
  recordVerificationError: jest.fn(),
  completeRefund: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  aggregate: jest.fn(),
  getPaymentStats: jest.fn(),
}));

jest.mock("../subscription", () => ({
  getUserActiveSubscription: jest.fn(),
  scheduleDowngrade: jest.fn(),
  applyScheduledDowngrade: jest.fn(),
  cancelSubscription: jest.fn(),
}));

jest.mock("../utils/paystackUtils", () => ({
  verifyPaystackPayment: jest.fn(),
  getPaystackSecretKey: jest.fn(),
}));

jest.mock("axios", () => ({
  post: jest.fn(),
}));

jest.mock("../middleware/eventNotification", () => ({
  publishEvent: jest.fn(),
}));

jest.mock("../user", () => ({
  findById: jest.fn(),
}));

const User = require("../user");
const Subscription = require("../subscription");
const { publishEvent } = require("../middleware/eventNotification");
const adminPaymentRoutes = require("../routes/adminPayment");
const errorHandler = require("../middleware/errorHandler");

describe("Admin Payment Routes Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { _id: "admin-1" };
      next();
    });
    app.use("/api/admin", adminPaymentRoutes);
    app.use(errorHandler);
  });

  it("allows admin to downgrade a user's subscription immediately", async () => {
    User.findById.mockResolvedValue({ _id: "admin-1", isAdmin: true });

    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-1",
      status: "active",
      endDate: new Date("2026-04-10T00:00:00.000Z"),
      pendingDowngrade: { status: "none" },
      plan: "premium",
    });

    Subscription.scheduleDowngrade.mockResolvedValue({
      _id: "sub-1",
      pendingDowngrade: {
        status: "scheduled",
        targetPlan: null,
      },
    });

    Subscription.applyScheduledDowngrade.mockResolvedValue({
      _id: "sub-1",
      status: "expired",
      plan: "premium",
      pendingDowngrade: {
        status: "applied",
        targetPlan: null,
      },
    });

    const response = await request(app)
      .post("/api/admin/subscriptions/user-9/downgrade")
      .send({ immediate: true, reason: "Policy enforcement" });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/immediately/i);
    expect(Subscription.scheduleDowngrade).toHaveBeenCalledWith(
      "user-9",
      null,
      expect.any(Date),
    );
    expect(Subscription.applyScheduledDowngrade).toHaveBeenCalledWith("sub-1");
    expect(publishEvent).toHaveBeenCalledWith(
      "payment_events",
      "admin.subscription.downgraded",
      expect.objectContaining({
        adminId: "admin-1",
        userId: "user-9",
        immediate: true,
      }),
    );
  });

  it("rejects manual downgrade for non-admin requester", async () => {
    User.findById.mockResolvedValue({ _id: "admin-1", isAdmin: false });

    const response = await request(app)
      .post("/api/admin/subscriptions/user-9/downgrade")
      .send({ immediate: true });

    expect(response.status).toBe(403);
  });

  it("schedules downgrade when immediate is false", async () => {
    User.findById.mockResolvedValue({ _id: "admin-1", isAdmin: true });

    const endDate = new Date("2026-04-10T00:00:00.000Z");
    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-2",
      status: "active",
      endDate,
      pendingDowngrade: { status: "none" },
      plan: "premium",
    });

    Subscription.scheduleDowngrade.mockResolvedValue({
      _id: "sub-2",
      status: "active",
      plan: "premium",
      pendingDowngrade: {
        status: "scheduled",
        targetPlan: null,
        effectiveAt: endDate,
      },
    });

    const response = await request(app)
      .post("/api/admin/subscriptions/user-7/downgrade")
      .send({ immediate: false, reason: "Planned downgrade" });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/scheduled/i);
    expect(Subscription.applyScheduledDowngrade).not.toHaveBeenCalled();
    expect(Subscription.scheduleDowngrade).toHaveBeenCalledWith(
      "user-7",
      null,
      endDate,
    );
  });
});

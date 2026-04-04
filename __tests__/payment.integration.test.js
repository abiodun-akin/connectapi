const express = require("express");
const request = require("supertest");

jest.mock("../paymentRecord", () => ({
  createPaymentRecord: jest.fn(),
  getPaymentByReference: jest.fn(),
  updatePaymentStatus: jest.fn(),
  recordVerificationError: jest.fn(),
  getInvoicesByUser: jest.fn(),
}));

jest.mock("../subscription", () => ({
  getUserActiveSubscription: jest.fn(),
  saveAuthorizationCode: jest.fn(),
  createOrUpdateSubscription: jest.fn(),
  cancelSubscription: jest.fn(),
  findOne: jest.fn(),
  hasEverSubscribed: jest.fn(),
  scheduleDowngrade: jest.fn(),
}));

jest.mock("../middleware/eventNotification", () => ({
  publishEvent: jest.fn(),
}));

jest.mock("../utils/activityScorer", () => ({
  recordPaymentViolation: jest.fn(),
}));

jest.mock("../utils/paystackUtils", () => ({
  verifyPaystackPayment: jest.fn(),
  validatePaystackResponse: jest.fn(),
  getSubscriptionEndDate: jest.fn(() => new Date("2026-04-10T00:00:00.000Z")),
}));

const PaymentRecord = require("../paymentRecord");
const Subscription = require("../subscription");
const { publishEvent } = require("../middleware/eventNotification");
const {
  verifyPaystackPayment,
  validatePaystackResponse,
} = require("../utils/paystackUtils");
const paymentRoutes = require("../routes/payment");
const errorHandler = require("../middleware/errorHandler");

describe("Payment Routes Integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { _id: "user-123", email: "user@example.com" };
      next();
    });
    app.use("/api/payment", paymentRoutes);
    app.use(errorHandler);
  });

  it("initializes a trial authorization instead of a full charge during trial", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue({
      status: "trial",
      isCardAuthorized: false,
    });
    PaymentRecord.createPaymentRecord.mockResolvedValue({ _id: "payment-1" });

    const response = await request(app)
      .post("/api/payment/initialize")
      .send({ plan: "premium", amount: 5000, email: "user@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.isTrialAuth).toBe(true);
    expect(response.body.paymentData.amount).toBe(50);
    expect(PaymentRecord.createPaymentRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 50,
        type: "trial_auth",
        plan: "premium",
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(
      "payment_events",
      "payment.initialized",
      expect.objectContaining({ isTrialAuth: true, amount: 50 }),
    );
  });

  it("stores authorization code during verification for trial auth payments", async () => {
    PaymentRecord.getPaymentByReference.mockResolvedValue({
      reference: "ref_trial_1",
      amount: 50,
      type: "trial_auth",
      email: "user@example.com",
    });
    verifyPaystackPayment.mockResolvedValue({
      status: "success",
      amount: 5000,
      reference: "ref_trial_1",
      authorization: { authorization_code: "AUTH_demo_123" },
    });
    validatePaystackResponse.mockReturnValue(true);
    PaymentRecord.updatePaymentStatus.mockResolvedValue({});

    const response = await request(app)
      .post("/api/payment/verify")
      .send({ reference: "ref_trial_1", plan: "premium" });

    expect(response.status).toBe(200);
    expect(Subscription.saveAuthorizationCode).toHaveBeenCalledWith(
      "user-123",
      "AUTH_demo_123",
      "user@example.com",
    );
  });

  it("finalizes trial auth payment without creating a paid subscription immediately", async () => {
    const save = jest.fn().mockResolvedValue({});
    PaymentRecord.getPaymentByReference.mockResolvedValue({
      status: "verified",
      type: "trial_auth",
      save,
    });

    const response = await request(app)
      .post("/api/payment/success")
      .send({ reference: "ref_trial_1", plan: "premium" });

    expect(response.status).toBe(200);
    expect(response.body.isCardAuthorization).toBe(true);
    expect(Subscription.createOrUpdateSubscription).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("schedules downgrade to free access without creating invoice", async () => {
    const subscription = {
      _id: "sub-1",
      plan: "premium",
      amount: 12000,
      endDate: new Date("2026-04-10T00:00:00.000Z"),
    };

    Subscription.getUserActiveSubscription.mockResolvedValue(subscription);
    Subscription.scheduleDowngrade.mockResolvedValue({
      ...subscription,
      pendingDowngrade: {
        targetPlan: null,
        status: "scheduled",
      },
    });

    const response = await request(app).post("/api/payment/downgrade");

    expect(response.status).toBe(200);
    expect(response.body.accessChange).toEqual(
      expect.objectContaining({
        from: "premium",
        to: "free",
      }),
    );
    expect(Subscription.scheduleDowngrade).toHaveBeenCalledWith(
      "user-123",
      null,
      subscription.endDate,
    );
    expect(PaymentRecord.createPaymentRecord).not.toHaveBeenCalled();
  });

  it("returns user invoices", async () => {
    PaymentRecord.getInvoicesByUser.mockResolvedValue([
      {
        reference: "inv_1",
        plan: "basic",
        amount: 5000,
        status: "pending",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        description: "Scheduled downgrade invoice",
      },
    ]);

    const response = await request(app).get("/api/payment/invoices");

    expect(response.status).toBe(200);
    expect(response.body.invoices).toHaveLength(1);
    expect(response.body.invoices[0]).toEqual(
      expect.objectContaining({
        reference: "inv_1",
        plan: "basic",
        amount: 5000,
      }),
    );
  });
});

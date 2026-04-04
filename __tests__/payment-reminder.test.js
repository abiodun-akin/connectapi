jest.mock("../subscription", () => ({
  find: jest.fn(),
  applyScheduledDowngrade: jest.fn(),
}));

jest.mock("../user", () => ({
  findById: jest.fn(),
}));

jest.mock("../middleware/eventNotification", () => ({
  publishEvent: jest.fn(),
}));

// Stub out other trialWorker dependencies that are imported at module top
jest.mock("../utils/activityScorer", () => ({
  recordPaymentViolation: jest.fn(),
}));

jest.mock("../utils/paystackUtils", () => ({
  verifyPaystackPayment: jest.fn(),
  validatePaystackResponse: jest.fn(),
  chargeAuthorization: jest.fn(),
  getSubscriptionEndDate: jest.fn(),
}));

const Subscription = require("../subscription");
const User = require("../user");
const { publishEvent } = require("../middleware/eventNotification");
const {
  processPaymentReminders,
  processScheduledDowngrades,
} = require("../workers/trialWorker");

const makeSubscription = (overrides = {}) => {
  const renewalDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
  return {
    _id: "sub-001",
    user_id: "user-001",
    status: "active",
    autoRenewal: true,
    plan: "basic",
    amount: 5000,
    renewalDate,
    paymentReminderSentAt: null,
    paymentReminderLastRenewalDate: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
};

describe("processPaymentReminders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 0 and publishes no events when there are no subscriptions in the window", async () => {
    Subscription.find.mockResolvedValue([]);

    const count = await processPaymentReminders();

    expect(count).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("skips subscription already reminded for the current renewal date (idempotency)", async () => {
    const renewalDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const subscription = makeSubscription({
      renewalDate,
      // idempotency stamp matches current renewalDate — should be skipped
      paymentReminderLastRenewalDate: renewalDate,
    });
    Subscription.find.mockResolvedValue([subscription]);

    const count = await processPaymentReminders();

    expect(count).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
    expect(subscription.save).not.toHaveBeenCalled();
  });

  it("sends reminder and saves idempotency stamp for subscription with no prior reminder", async () => {
    const subscription = makeSubscription({
      paymentReminderLastRenewalDate: null,
    });
    const user = { _id: "user-001", email: "farmer@example.com" };
    Subscription.find.mockResolvedValue([subscription]);
    User.findById.mockResolvedValue(user);

    const count = await processPaymentReminders();

    expect(count).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(
      "payment_events",
      "payment.reminder",
      expect.objectContaining({
        userId: user._id,
        email: user.email,
        subscriptionId: subscription._id,
        plan: "basic",
        amount: 5000,
        renewalDate: subscription.renewalDate,
        daysUntilRenewal: expect.any(Number),
      }),
    );
    expect(subscription.paymentReminderLastRenewalDate).toEqual(
      subscription.renewalDate,
    );
    expect(subscription.paymentReminderSentAt).toBeInstanceOf(Date);
    expect(subscription.save).toHaveBeenCalledTimes(1);
  });

  it("sends reminder when paymentReminderLastRenewalDate is from a previous cycle", async () => {
    const previousRenewalDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    const currentRenewalDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const subscription = makeSubscription({
      renewalDate: currentRenewalDate,
      paymentReminderLastRenewalDate: previousRenewalDate,
    });
    const user = { _id: "user-001", email: "farmer@example.com" };
    Subscription.find.mockResolvedValue([subscription]);
    User.findById.mockResolvedValue(user);

    const count = await processPaymentReminders();

    expect(count).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it("skips subscriptions where user cannot be found", async () => {
    const subscription = makeSubscription();
    Subscription.find.mockResolvedValue([subscription]);
    User.findById.mockResolvedValue(null);

    const count = await processPaymentReminders();

    expect(count).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("processes only eligible subscriptions when mixed with already-reminded ones", async () => {
    const renewalDateA = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
    const renewalDateB = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    const alreadyReminded = makeSubscription({
      _id: "sub-already",
      renewalDate: renewalDateA,
      paymentReminderLastRenewalDate: renewalDateA, // already reminded
    });
    const needsReminder = makeSubscription({
      _id: "sub-needs",
      renewalDate: renewalDateB,
      paymentReminderLastRenewalDate: null,
    });

    Subscription.find.mockResolvedValue([alreadyReminded, needsReminder]);
    User.findById.mockResolvedValue({
      _id: "user-001",
      email: "farmer@example.com",
    });

    const count = await processPaymentReminders();

    expect(count).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(
      "payment_events",
      "payment.reminder",
      expect.objectContaining({ subscriptionId: "sub-needs" }),
    );
    expect(alreadyReminded.save).not.toHaveBeenCalled();
    expect(needsReminder.save).toHaveBeenCalledTimes(1);
  });

  it("returns 0 gracefully when Subscription.find throws", async () => {
    Subscription.find.mockRejectedValue(new Error("DB connection failed"));

    const count = await processPaymentReminders();

    expect(count).toBe(0);
  });
});

describe("processScheduledDowngrades", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 0 when there are no scheduled downgrades due", async () => {
    Subscription.find.mockResolvedValue([]);

    const count = await processScheduledDowngrades();

    expect(count).toBe(0);
    expect(Subscription.applyScheduledDowngrade).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("applies scheduled downgrade and publishes event", async () => {
    const dueSub = {
      _id: "sub-due-1",
      user_id: "user-001",
      pendingDowngrade: {
        status: "scheduled",
        effectiveAt: new Date(Date.now() - 60 * 1000),
      },
    };
    Subscription.find.mockResolvedValue([dueSub]);
    Subscription.applyScheduledDowngrade.mockResolvedValue({
      _id: "sub-due-1",
      user_id: "user-001",
      status: "expired",
      plan: "premium",
    });
    User.findById.mockResolvedValue({
      _id: "user-001",
      email: "user@example.com",
    });

    const count = await processScheduledDowngrades();

    expect(count).toBe(1);
    expect(Subscription.applyScheduledDowngrade).toHaveBeenCalledWith(
      "sub-due-1",
    );
    expect(publishEvent).toHaveBeenCalledWith(
      "payment_events",
      "payment.downgrade.applied",
      expect.objectContaining({
        userId: "user-001",
        email: "user@example.com",
        subscriptionId: "sub-due-1",
        status: "expired",
      }),
    );
  });

  it("returns 0 gracefully when query fails", async () => {
    Subscription.find.mockRejectedValue(new Error("query failed"));

    const count = await processScheduledDowngrades();

    expect(count).toBe(0);
  });
});

jest.mock("../subscription", () => ({
  getUserActiveSubscription: jest.fn(),
  hasEverSubscribed: jest.fn(),
}));

const Subscription = require("../subscription");
const requireFeatureAccess = require("../middleware/requireFeatureAccess");
const {
  FEATURE_ACCESS,
  SUBSCRIPTION_STATUS,
} = require("../utils/subscriptionAccess");

const createRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe("requireFeatureAccess middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 403 for never-subscribed users on core feature", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    Subscription.hasEverSubscribed.mockResolvedValue(false);

    const req = { user: { _id: "user-1" } };
    const res = createRes();
    const next = jest.fn();

    await requireFeatureAccess(FEATURE_ACCESS.CORE)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SUBSCRIPTION_REQUIRED",
        subscriptionStatus: SUBSCRIPTION_STATUS.NEVER_SUBSCRIBED,
        feature: FEATURE_ACCESS.CORE,
        hasEverSubscribed: false,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for expired users on core feature", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const req = { user: { _id: "user-2" } };
    const res = createRes();
    const next = jest.fn();

    await requireFeatureAccess(FEATURE_ACCESS.CORE)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SUBSCRIPTION_REQUIRED",
        subscriptionStatus: SUBSCRIPTION_STATUS.EXPIRED,
        feature: FEATURE_ACCESS.CORE,
        hasEverSubscribed: true,
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows expired users on profile feature", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const req = { user: { _id: "user-3" } };
    const res = createRes();
    const next = jest.fn();

    await requireFeatureAccess(FEATURE_ACCESS.PROFILE)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.subscriptionAccess).toEqual(
      expect.objectContaining({
        feature: FEATURE_ACCESS.PROFILE,
        statusType: SUBSCRIPTION_STATUS.EXPIRED,
        hasEverSubscribed: true,
        hasActiveSubscription: false,
      })
    );
  });

  it("allows active users on core feature", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-1",
      endDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    Subscription.hasEverSubscribed.mockResolvedValue(true);

    const req = { user: { _id: "user-4" } };
    const res = createRes();
    const next = jest.fn();

    await requireFeatureAccess(FEATURE_ACCESS.CORE)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(req.subscriptionAccess).toEqual(
      expect.objectContaining({
        feature: FEATURE_ACCESS.CORE,
        statusType: SUBSCRIPTION_STATUS.ACTIVE,
        hasEverSubscribed: true,
        hasActiveSubscription: true,
      })
    );
  });

  it("passes errors to next when subscription lookup fails", async () => {
    const dbError = new Error("database unavailable");
    Subscription.getUserActiveSubscription.mockRejectedValue(dbError);

    const req = { user: { _id: "user-5" } };
    const res = createRes();
    const next = jest.fn();

    await requireFeatureAccess(FEATURE_ACCESS.CORE)(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});

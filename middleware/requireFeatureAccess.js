const Subscription = require("../subscription");
const {
  FEATURE_ACCESS,
  getSubscriptionStatusType,
  canAccessFeature,
} = require("../utils/subscriptionAccess");

const requireFeatureAccess = (feature = FEATURE_ACCESS.CORE) => async (req, res, next) => {
  try {
    const [subscription, hasEverSubscribed] = await Promise.all([
      Subscription.getUserActiveSubscription(req.user._id),
      Subscription.hasEverSubscribed(req.user._id),
    ]);

    const statusType = getSubscriptionStatusType({ subscription, hasEverSubscribed });

    if (!canAccessFeature({ statusType, feature })) {
      return res.status(403).json({
        error: "An active subscription is required for this feature.",
        code: "SUBSCRIPTION_REQUIRED",
        feature,
        subscriptionStatus: statusType,
        hasEverSubscribed,
      });
    }

    req.subscriptionAccess = {
      feature,
      statusType,
      hasEverSubscribed,
      hasActiveSubscription: !!subscription,
    };

    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = requireFeatureAccess;

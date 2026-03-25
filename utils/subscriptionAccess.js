const FEATURE_ACCESS = Object.freeze({
  CORE: "core",
  PROFILE: "profile",
  ANALYTICS: "analytics",
});

const SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: "active",
  EXPIRED: "expired",
  NEVER_SUBSCRIBED: "never-subscribed",
});

const featurePolicy = Object.freeze({
  [FEATURE_ACCESS.CORE]: [SUBSCRIPTION_STATUS.ACTIVE],
  [FEATURE_ACCESS.ANALYTICS]: [SUBSCRIPTION_STATUS.ACTIVE],
  [FEATURE_ACCESS.PROFILE]: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.EXPIRED],
});

const getSubscriptionStatusType = ({ subscription, hasEverSubscribed }) => {
  if (!subscription || !subscription.endDate) {
    return hasEverSubscribed
      ? SUBSCRIPTION_STATUS.EXPIRED
      : SUBSCRIPTION_STATUS.NEVER_SUBSCRIBED;
  }

  const endDate = new Date(subscription.endDate);
  return endDate > new Date()
    ? SUBSCRIPTION_STATUS.ACTIVE
    : SUBSCRIPTION_STATUS.EXPIRED;
};

const canAccessFeature = ({ statusType, feature = FEATURE_ACCESS.CORE }) => {
  const allowedStatuses = featurePolicy[feature] || featurePolicy[FEATURE_ACCESS.CORE];
  return allowedStatuses.includes(statusType);
};

module.exports = {
  FEATURE_ACCESS,
  SUBSCRIPTION_STATUS,
  getSubscriptionStatusType,
  canAccessFeature,
};

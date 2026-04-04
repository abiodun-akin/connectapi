const mongoose = require("mongoose");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SINGLE_PAID_PLAN = "premium";

const subscriptionSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["basic", "premium", "enterprise"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired", "pending", "trial"],
      default: "active",
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "NGN",
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      required: true,
    },
    renewalDate: {
      type: Date,
    },
    autoRenewal: {
      type: Boolean,
      default: true,
    },
    paymentReferences: [
      {
        reference: String,
        paymentDate: Date,
        amount: Number,
      },
    ],
    // Trial-specific fields
    isTrialPeriod: {
      type: Boolean,
      default: false,
    },
    trialStartDate: Date,
    trialEndDate: Date,
    trialReminderSentAt: Date,
    paymentRequiredBy: Date,
    hasPaymentPending: {
      type: Boolean,
      default: false,
    },
    paymentReminderSentAt: {
      type: Date,
      default: null,
    },
    paymentReminderLastRenewalDate: {
      type: Date,
      default: null,
    },
    hasUsedActiveTopup: {
      type: Boolean,
      default: false,
    },
    cancellationReason: String,
    // Card authorization for deferred trial billing
    paystackAuthCode: {
      type: String,
      default: null,
    },
    paystackAuthEmail: {
      type: String,
      default: null,
    },
    isCardAuthorized: {
      type: Boolean,
      default: false,
    },
    pendingDowngrade: {
      targetPlan: {
        type: String,
        enum: ["basic", "premium", "enterprise", null],
        default: null,
      },
      effectiveAt: {
        type: Date,
        default: null,
      },
      requestedAt: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ["none", "scheduled", "applied", "cancelled"],
        default: "none",
      },
    },
  },
  {
    timestamps: true,
  },
);

// Index for trial expiry tracking
subscriptionSchema.index({ status: 1, trialEndDate: 1 });
subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.statics.createOrUpdateSubscription = async function (
  userId,
  subscriptionData,
) {
  const { amount, startDate, endDate, reference } = subscriptionData;
  const plan = SINGLE_PAID_PLAN;
  const now = new Date();
  const durationMs = Math.max(
    new Date(endDate).getTime() - new Date(startDate).getTime(),
    30 * MS_PER_DAY,
  );

  // Check if user already has an active subscription
  let subscription = await this.findOne({
    user_id: userId,
    status: "active",
  });

  if (subscription) {
    const isCurrentlyActive =
      subscription.endDate && subscription.endDate > now;

    if (isCurrentlyActive && subscription.hasUsedActiveTopup) {
      const error = new Error(
        "Only one extra payment is allowed while subscription is active",
      );
      error.code = "ACTIVE_TOPUP_LIMIT_REACHED";
      throw error;
    }

    // Update existing subscription
    subscription.plan = plan;
    subscription.amount = amount;
    subscription.status = "active";

    if (isCurrentlyActive) {
      subscription.endDate = new Date(
        subscription.endDate.getTime() + durationMs,
      );
      subscription.hasUsedActiveTopup = true;
    } else {
      subscription.startDate = startDate;
      subscription.endDate = endDate;
      subscription.hasUsedActiveTopup = false;
    }

    subscription.renewalDate = new Date(
      subscription.endDate.getTime() + MS_PER_DAY,
    ); // 1 day after end
    subscription.paymentReferences.push({
      reference,
      paymentDate: startDate,
      amount,
    });
  } else {
    // Create new subscription
    subscription = await this.create({
      user_id: userId,
      plan,
      amount,
      startDate,
      endDate,
      renewalDate: new Date(endDate.getTime() + MS_PER_DAY),
      hasUsedActiveTopup: false,
      paymentReferences: [
        {
          reference,
          paymentDate: startDate,
          amount,
        },
      ],
    });
  }

  await subscription.save();
  return subscription;
};

subscriptionSchema.statics.isUserSubscribed = async function (userId, plan) {
  const subscription = await this.findOne({
    user_id: userId,
    status: "active",
    endDate: { $gt: new Date() },
  });

  if (!subscription) return false;
  if (!plan) return true; // Check if user has any active subscription

  return subscription.plan === plan;
};

subscriptionSchema.statics.getUserActiveSubscription = async function (userId) {
  return this.findOne({
    user_id: userId,
    status: { $in: ["active", "trial"] },
    endDate: { $gt: new Date() },
  }).sort({
    status: 1,
    endDate: -1,
  });
};

subscriptionSchema.statics.expireSubscription = async function (
  subscriptionId,
) {
  return this.findByIdAndUpdate(
    subscriptionId,
    { status: "expired" },
    { new: true },
  );
};

// Trial-specific methods
subscriptionSchema.statics.createTrialSubscription = async function (
  userId,
  _plan = SINGLE_PAID_PLAN,
) {
  const trialStartDate = new Date();
  const trialEndDate = new Date(
    trialStartDate.getTime() + 30 * 24 * 60 * 60 * 1000,
  ); // 30 days

  return this.create({
    user_id: userId,
    plan: SINGLE_PAID_PLAN,
    status: "trial",
    isTrialPeriod: true,
    amount: 0, // First charge is zero for free trial activation
    startDate: trialStartDate,
    trialStartDate,
    trialEndDate,
    endDate: trialEndDate,
    renewalDate: trialEndDate,
    paymentRequiredBy: trialEndDate,
    autoRenewal: true,
  });
};

subscriptionSchema.statics.getUserTrialSubscription = async function (userId) {
  return this.findOne({
    user_id: userId,
    status: "trial",
    trialEndDate: { $gt: new Date() },
  });
};

subscriptionSchema.statics.hasActiveOrTrialSubscription = async function (
  userId,
) {
  const subscription = await this.findOne({
    user_id: userId,
    status: { $in: ["active", "trial"] },
    endDate: { $gt: new Date() },
  });
  return !!subscription;
};

subscriptionSchema.statics.hasEverSubscribed = async function (userId) {
  const subscription = await this.findOne({
    user_id: userId,
    status: { $in: ["active", "expired", "cancelled"] },
  });
  return !!subscription;
};

subscriptionSchema.statics.convertTrialToPayment = async function (
  userId,
  subscriptionData,
) {
  const { amount, reference, endDate } = subscriptionData;

  return this.findOneAndUpdate(
    { user_id: userId, status: "trial" },
    {
      status: "active",
      isTrialPeriod: false,
      plan: SINGLE_PAID_PLAN,
      amount,
      endDate,
      renewalDate: new Date(endDate.getTime() + 24 * 60 * 60 * 1000),
      paymentReferences: [
        {
          reference,
          paymentDate: new Date(),
          amount,
        },
      ],
      autoRenewal: true,
    },
    { new: true },
  );
};

subscriptionSchema.statics.cancelSubscription = async function (
  userId,
  reason,
) {
  return this.findOneAndUpdate(
    { user_id: userId, status: { $in: ["active", "trial"] } },
    {
      status: "cancelled",
      cancellationReason: reason,
    },
    { new: true },
  );
};

subscriptionSchema.statics.getExpiredTrials = async function () {
  return this.find({
    status: "trial",
    trialEndDate: { $lt: new Date() },
  });
};

subscriptionSchema.statics.saveAuthorizationCode = async function (
  userId,
  authCode,
  email,
) {
  return this.findOneAndUpdate(
    { user_id: userId, status: "trial" },
    {
      paystackAuthCode: authCode,
      paystackAuthEmail: email,
      isCardAuthorized: true,
    },
    { new: true },
  );
};

subscriptionSchema.statics.scheduleDowngrade = async function (
  userId,
  targetPlan,
  effectiveAt,
) {
  return this.findOneAndUpdate(
    {
      user_id: userId,
      status: { $in: ["active", "trial"] },
      endDate: { $gt: new Date() },
    },
    {
      pendingDowngrade: {
        targetPlan,
        effectiveAt,
        requestedAt: new Date(),
        status: "scheduled",
      },
    },
    { new: true },
  );
};

subscriptionSchema.statics.applyScheduledDowngrade = async function (
  subscriptionId,
) {
  const subscription = await this.findById(subscriptionId);
  if (!subscription || subscription.pendingDowngrade?.status !== "scheduled") {
    return null;
  }

  if (
    subscription.pendingDowngrade.effectiveAt &&
    new Date(subscription.pendingDowngrade.effectiveAt) > new Date()
  ) {
    return null;
  }

  if (subscription.pendingDowngrade.targetPlan) {
    subscription.plan = subscription.pendingDowngrade.targetPlan;
  } else {
    subscription.status = "expired";
    subscription.autoRenewal = false;
    subscription.cancellationReason = "Scheduled downgrade to free access";
  }

  subscription.pendingDowngrade.status = "applied";
  await subscription.save();
  return subscription;
};

const Subscription = mongoose.model("Subscription", subscriptionSchema);
module.exports = Subscription;

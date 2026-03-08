const mongoose = require("mongoose");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    hasUsedActiveTopup: {
      type: Boolean,
      default: false,
    },
    cancellationReason: String,
  },
  {
    timestamps: true,
  }
);

// Index for trial expiry tracking
subscriptionSchema.index({ status: 1, trialEndDate: 1 });
subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.statics.createOrUpdateSubscription = async function (
  userId,
  subscriptionData
) {
  const { plan, amount, startDate, endDate, reference } = subscriptionData;
  const now = new Date();
  const durationMs = Math.max(new Date(endDate).getTime() - new Date(startDate).getTime(), 30 * MS_PER_DAY);

  // Check if user already has an active subscription
  let subscription = await this.findOne({
    user_id: userId,
    status: "active",
  });

  if (subscription) {
    const isCurrentlyActive = subscription.endDate && subscription.endDate > now;

    if (isCurrentlyActive && subscription.hasUsedActiveTopup) {
      const error = new Error("Only one extra payment is allowed while subscription is active");
      error.code = "ACTIVE_TOPUP_LIMIT_REACHED";
      throw error;
    }

    // Update existing subscription
    subscription.plan = plan;
    subscription.amount = amount;
    subscription.status = "active";

    if (isCurrentlyActive) {
      subscription.endDate = new Date(subscription.endDate.getTime() + durationMs);
      subscription.hasUsedActiveTopup = true;
    } else {
      subscription.startDate = startDate;
      subscription.endDate = endDate;
      subscription.hasUsedActiveTopup = false;
    }

    subscription.renewalDate = new Date(subscription.endDate.getTime() + MS_PER_DAY); // 1 day after end
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
  subscriptionId
) {
  return this.findByIdAndUpdate(
    subscriptionId,
    { status: "expired" },
    { new: true }
  );
};

// Trial-specific methods
subscriptionSchema.statics.createTrialSubscription = async function (userId, plan = "basic") {
  const trialStartDate = new Date();
  const trialEndDate = new Date(trialStartDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  return this.create({
    user_id: userId,
    plan,
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

subscriptionSchema.statics.hasActiveOrTrialSubscription = async function (userId) {
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
  subscriptionData
) {
  const { plan, amount, reference, endDate } = subscriptionData;

  return this.findOneAndUpdate(
    { user_id: userId, status: "trial" },
    {
      status: "active",
      isTrialPeriod: false,
      plan,
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
    { new: true }
  );
};

subscriptionSchema.statics.cancelSubscription = async function (userId, reason) {
  return this.findOneAndUpdate(
    { user_id: userId, status: { $in: ["active", "trial"] } },
    {
      status: "cancelled",
      cancellationReason: reason,
    },
    { new: true }
  );
};

subscriptionSchema.statics.getExpiredTrials = async function () {
  return this.find({
    status: "trial",
    trialEndDate: { $lt: new Date() },
  });
};

const Subscription = mongoose.model("Subscription", subscriptionSchema);
module.exports = Subscription;

/**
 * Trial Expiration Worker
 * Background job to:
 * - Send reminder emails 3 days before trial expiry
 * - Auto-cancel expired trials
 * - Check for overdue payment
 */

const Subscription = require("../subscription");
const User = require("../user");
const { publishEvent } = require("../middleware/eventNotification");
const { recordPaymentViolation } = require("../utils/activityScorer");

/**
 * Check and process trial expirations
 * Should be called by cron job (e.g., daily)
 */
async function processTrialExpirations() {
  try {
    console.log("[Trial Worker] Starting trial expiration check...");

    // Get expired trials
    const expiredTrials = await Subscription.getExpiredTrials();
    console.log(`[Trial Worker] Found ${expiredTrials.length} expired trials`);

    for (const subscription of expiredTrials) {
      try {
        const user = await User.findById(subscription.user_id);
        if (!user) continue;

        // Check if payment has been made
        const paymentRecord = await require("../paymentRecord").findOne({
          subscription_id: subscription._id,
          status: "verified",
        });

        if (paymentRecord) {
          // Payment completed, convert trial to paid subscription
          const updated = await Subscription.convertTrialToPayment(subscription._id);
          console.log(`[Trial Worker] Converted trial to paid for user ${user.email}`);

          // Publish success event
          await publishEvent("subscription.converted", {
            userId: user._id,
            email: user.email,
            subscriptionId: subscription._id,
          });
        } else {
          // No payment, cancel subscription
          const cancelled = await Subscription.cancelSubscription(
            subscription._id,
            "Trial period expired - no payment received"
          );
          console.log(`[Trial Worker] Cancelled expired trial for user ${user.email}`);

          await recordPaymentViolation(user._id, "default");

          // Publish cancellation event
          await publishEvent("subscription.cancelled", {
            userId: user._id,
            email: user.email,
            subscriptionId: subscription._id,
            reason: "Trial period expired - no payment received",
          });
        }
      } catch (error) {
        console.error(
          `[Trial Worker] Error processing trial for subscription ${subscription._id}:`,
          error
        );
      }
    }

    // Send reminder emails (3 days before expiry)
    const remindingTrials = await Subscription.find({
      isTrialPeriod: true,
      status: "trial",
      trialReminderSentAt: null,
      trialEndDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Next 3 days
      },
    });

    console.log(`[Trial Worker] Found ${remindingTrials.length} trials for reminders`);

    for (const subscription of remindingTrials) {
      try {
        const user = await User.findById(subscription.user_id);
        if (!user) continue;

        // Send reminder email
        await publishEvent("trial.reminder", {
          userId: user._id,
          email: user.email,
          subscriptionId: subscription._id,
          trialEndDate: subscription.trialEndDate,
          daysRemaining: Math.ceil(
            (subscription.trialEndDate - new Date()) / (24 * 60 * 60 * 1000)
          ),
        });

        // Mark reminder as sent
        subscription.trialReminderSentAt = new Date();
        await subscription.save();

        console.log(`[Trial Worker] Reminder sent to ${user.email}`);
      } catch (error) {
        console.error(
          `[Trial Worker] Error sending reminder for subscription ${subscription._id}:`,
          error
        );
      }
    }

    console.log("[Trial Worker] Trial expiration check completed");
  } catch (error) {
    console.error("[Trial Worker] Fatal error:", error);
  }
}

/**
 * Get trial status for dashboard
 */
async function getTrialStatus(userId) {
  try {
    const subscription = await Subscription.getUserTrialSubscription(userId);

    if (!subscription) {
      return null;
    }

    const now = new Date();
    const daysRemaining = Math.ceil(
      (subscription.trialEndDate - now) / (24 * 60 * 60 * 1000)
    );

    return {
      isActive: subscription.status === "trial",
      startDate: subscription.trialStartDate,
      endDate: subscription.trialEndDate,
      daysRemaining: Math.max(daysRemaining, 0),
      isExpired: subscription.trialEndDate < now,
      isExpiringSoon: daysRemaining <= 3 && daysRemaining > 0,
      paymentRequiredBy: subscription.paymentRequiredBy,
      reminderSent: !!subscription.trialReminderSentAt,
    };
  } catch (error) {
    console.error("[Trial Worker] Error getting trial status:", error);
    return null;
  }
}

/**
 * Force check and cancel overdue trials
 */
async function cancelOverdueTrials() {
  try {
    console.log("[Trial Worker] Checking for overdue trials...");

    const overdueTrials = await Subscription.find({
      isTrialPeriod: true,
      status: "trial",
      paymentRequiredBy: { $lt: new Date() },
      hasPaymentPending: false,
    });

    console.log(`[Trial Worker] Found ${overdueTrials.length} overdue trials`);

    for (const subscription of overdueTrials) {
      try {
        const cancelled = await Subscription.cancelSubscription(
          subscription._id,
          "Trial period expired - payment required date passed"
        );
        console.log(`[Trial Worker] Cancelled overdue trial: ${subscription._id}`);

        await recordPaymentViolation(subscription.user_id, "default");

        const user = await User.findById(subscription.user_id);
        if (user) {
          await publishEvent("subscription.cancelled", {
            userId: user._id,
            email: user.email,
            subscriptionId: subscription._id,
            reason: "Trial period expired - payment required date passed",
          });
        }
      } catch (error) {
        console.error(`[Trial Worker] Error cancelling overdue trial:`, error);
      }
    }
  } catch (error) {
    console.error("[Trial Worker] Fatal error in cancelOverdueTrials:", error);
  }
}

module.exports = {
  processTrialExpirations,
  getTrialStatus,
  cancelOverdueTrials,
};

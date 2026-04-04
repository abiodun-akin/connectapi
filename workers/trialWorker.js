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
const {
  chargeAuthorization,
  getSubscriptionEndDate,
} = require("../utils/paystackUtils");

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

        if (subscription.paystackAuthCode) {
          // Card was authorized during trial — attempt to charge the full subscription fee
          let chargeResult;
          try {
            chargeResult = await chargeAuthorization(
              subscription.paystackAuthCode,
              subscription.paystackAuthEmail || user.email,
              5000,
            );
          } catch (chargeErr) {
            console.error(
              `[Trial Worker] Charge failed for user ${user.email}:`,
              chargeErr.message,
            );
          }

          if (chargeResult?.status === "success") {
            const endDate = getSubscriptionEndDate(subscription.plan);
            await Subscription.convertTrialToPayment(user._id, {
              plan: subscription.plan,
              amount: 5000,
              reference: chargeResult.reference,
              endDate,
            });
            console.log(
              `[Trial Worker] Charged and converted trial to paid for user ${user.email}`,
            );

            await publishEvent("trial_events", "subscription.converted", {
              userId: user._id,
              email: user.email,
              subscriptionId: subscription._id,
              amount: 5000,
              endDate,
            });
          } else {
            // Charge failed or unavailable — cancel
            await Subscription.cancelSubscription(
              user._id,
              "Trial expired - card charge failed",
            );
            console.log(
              `[Trial Worker] Cancelled trial (charge failed) for user ${user.email}`,
            );

            await recordPaymentViolation(user._id, "default");

            await publishEvent("trial_events", "subscription.cancelled", {
              userId: user._id,
              email: user.email,
              subscriptionId: subscription._id,
              reason: "Trial period expired - card charge failed",
            });
          }
        } else {
          // No card authorization on file — cancel subscription
          await Subscription.cancelSubscription(
            user._id,
            "Trial period expired - no payment authorization",
          );
          console.log(
            `[Trial Worker] Cancelled expired trial (no card) for user ${user.email}`,
          );

          await recordPaymentViolation(user._id, "default");

          await publishEvent("trial_events", "subscription.cancelled", {
            userId: user._id,
            email: user.email,
            subscriptionId: subscription._id,
            reason: "Trial period expired - no payment authorization on file",
          });
        }
      } catch (error) {
        console.error(
          `[Trial Worker] Error processing trial for subscription ${subscription._id}:`,
          error,
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

    console.log(
      `[Trial Worker] Found ${remindingTrials.length} trials for reminders`,
    );

    for (const subscription of remindingTrials) {
      try {
        const user = await User.findById(subscription.user_id);
        if (!user) continue;

        // Send reminder email
        await publishEvent("trial_events", "trial.reminder", {
          userId: user._id,
          email: user.email,
          subscriptionId: subscription._id,
          trialEndDate: subscription.trialEndDate,
          daysRemaining: Math.ceil(
            (subscription.trialEndDate - new Date()) / (24 * 60 * 60 * 1000),
          ),
          isCardAuthorized: subscription.isCardAuthorized,
        });

        // Mark reminder as sent
        subscription.trialReminderSentAt = new Date();
        await subscription.save();

        console.log(`[Trial Worker] Reminder sent to ${user.email}`);
      } catch (error) {
        console.error(
          `[Trial Worker] Error sending reminder for subscription ${subscription._id}:`,
          error,
        );
      }
    }

    console.log("[Trial Worker] Trial expiration check completed");
  } catch (error) {
    console.error("[Trial Worker] Fatal error:", error);
  }
}

/**
 * Send renewal reminders for active subscriptions due in the next 3 days.
 * Uses paymentReminderLastRenewalDate to avoid duplicate reminders.
 */
async function processPaymentReminders() {
  try {
    const now = new Date();
    const reminderWindowEnd = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const subscriptions = await Subscription.find({
      status: "active",
      autoRenewal: true,
      renewalDate: {
        $gte: now,
        $lte: reminderWindowEnd,
      },
    });

    let remindersSent = 0;

    for (const subscription of subscriptions) {
      try {
        if (!subscription.renewalDate) continue;

        if (
          subscription.paymentReminderLastRenewalDate &&
          subscription.paymentReminderLastRenewalDate.getTime() ===
            new Date(subscription.renewalDate).getTime()
        ) {
          continue;
        }

        const user = await User.findById(subscription.user_id);
        if (!user) continue;

        const daysUntilRenewal = Math.max(
          0,
          Math.ceil(
            (new Date(subscription.renewalDate).getTime() - now.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        );

        await publishEvent("payment_events", "payment.reminder", {
          userId: user._id,
          email: user.email,
          subscriptionId: subscription._id,
          plan: subscription.plan,
          amount: subscription.amount,
          renewalDate: subscription.renewalDate,
          daysUntilRenewal,
        });

        subscription.paymentReminderSentAt = new Date();
        subscription.paymentReminderLastRenewalDate = subscription.renewalDate;
        await subscription.save();

        remindersSent += 1;
      } catch (error) {
        console.error(
          `[Trial Worker] Error sending payment reminder for subscription ${subscription._id}:`,
          error,
        );
      }
    }

    console.log(`[Trial Worker] Payment reminders sent: ${remindersSent}`);
    return remindersSent;
  } catch (error) {
    console.error(
      "[Trial Worker] Fatal error in processPaymentReminders:",
      error,
    );
    return 0;
  }
}

/**
 * Apply scheduled downgrades that have reached effectiveAt.
 * This enforces record-based entitlement changes at cycle boundary.
 */
async function processScheduledDowngrades() {
  try {
    const now = new Date();
    const scheduled = await Subscription.find({
      status: { $in: ["active", "trial"] },
      "pendingDowngrade.status": "scheduled",
      "pendingDowngrade.effectiveAt": { $lte: now },
    });

    let appliedCount = 0;

    for (const subscription of scheduled) {
      try {
        const updated = await Subscription.applyScheduledDowngrade(
          subscription._id,
        );
        if (!updated) {
          continue;
        }

        const user = await User.findById(updated.user_id);
        if (user) {
          await publishEvent("payment_events", "payment.downgrade.applied", {
            userId: user._id,
            email: user.email,
            subscriptionId: updated._id,
            status: updated.status,
            plan: updated.plan,
            timestamp: new Date(),
          });
        }

        appliedCount += 1;
      } catch (error) {
        console.error(
          `[Trial Worker] Error applying scheduled downgrade for subscription ${subscription._id}:`,
          error,
        );
      }
    }

    console.log(`[Trial Worker] Scheduled downgrades applied: ${appliedCount}`);
    return appliedCount;
  } catch (error) {
    console.error(
      "[Trial Worker] Fatal error in processScheduledDowngrades:",
      error,
    );
    return 0;
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
      (subscription.trialEndDate - now) / (24 * 60 * 60 * 1000),
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
        await Subscription.cancelSubscription(
          subscription.user_id,
          "Trial period expired - payment required date passed",
        );
        console.log(
          `[Trial Worker] Cancelled overdue trial: ${subscription._id}`,
        );

        await recordPaymentViolation(subscription.user_id, "default");

        const user = await User.findById(subscription.user_id);
        if (user) {
          await publishEvent("trial_events", "subscription.cancelled", {
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
  processPaymentReminders,
  processScheduledDowngrades,
  getTrialStatus,
  cancelOverdueTrials,
};

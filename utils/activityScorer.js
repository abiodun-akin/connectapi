/**
 * Activity Scoring System
 * Tracks user engagement and applies penalties for violations
 * Scores range from 0-100 with penalties for:
 * - Payment defaults (-20 points)
 * - Flagged messages (-5 to -15 points per flag)
 * - Account suspensions (-50 points)
 * - Inactivity decay (minimum 20 points)
 */

const User = require("../user");

// Base activity scoring thresholds
const ACTIVITY_THRESHOLDS = {
  profileComplete: 15,
  activeMessaging: 20, // 1+ message sent
  multipleMatches: 10, // 3+ matches
  consecutiveLogins: 10, // Login in last 7 days
  referrals: 15, // Each referral
  highEngagement: 10, // 10+ messages sent
};

// Penalties for violations
const PENALTIES = {
  paymentDefault: -20,
  paymentCancellation: -15,
  flaggedMessage: -5, // Per flag (can stack)
  multipleFlags: -10, // 3+ flags in 30 days
  accountSuspension: -50,
  reportedAbuse: -15,
  scamAttempt: -25,
};

// Decay settings
const DECAY_SETTINGS = {
  inactivityPeriodDays: 30,
  monthlyDecayPercent: 10, // Lose 10% per month of inactivity
  minimumScore: 20, // Never go below 20
};

/**
 * Calculate base activity score for a user
 */
async function calculateBaseActivityScore(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return 0;

    let score = 30; // Base starting score

    // Profile completion
    const profile = await require("../userProfile").findOne({ user_id: userId });
    if (profile && profile.isProfileComplete) {
      score += ACTIVITY_THRESHOLDS.profileComplete;
    }

    // Message activity
    const Message = require("../message");
    const messageCount = await Message.countDocuments({ sender_id: userId });

    if (messageCount > 0) {
      score += ACTIVITY_THRESHOLDS.activeMessaging;
    }

    if (messageCount >= 10) {
      score += ACTIVITY_THRESHOLDS.highEngagement;
    }

    // Match engagement
    const Match = require("../match");
    const matchCount = await Match.countDocuments({
      $or: [{ farmer_id: userId }, { vendor_id: userId }],
      status: { $in: ["interested", "connected"] },
    });

    if (matchCount >= 3) {
      score += ACTIVITY_THRESHOLDS.multipleMatches;
    }

    // Login history (check if user logged in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (user.lastLogin && user.lastLogin > sevenDaysAgo) {
      score += ACTIVITY_THRESHOLDS.consecutiveLogins;
    }

    // Cap score at 100
    return Math.min(score, 100);
  } catch (error) {
    console.error("[ActivityScorer] Error calculating base score:", error);
    return 30;
  }
}

/**
 * Calculate total activity score with all penalties applied
 */
async function calculateTotalActivityScore(userId) {
  try {
    let score = await calculateBaseActivityScore(userId);

    // Apply penalties
    const penalties = await getUserPenalties(userId);

    for (const penalty of penalties) {
      score += penalty.amount; // Negative values reduce score
    }

    // Apply inactivity decay
    const lastActiveDate = await getLastActiveDate(userId);
    const decayAmount = calculateInactivityDecay(lastActiveDate);
    score -= decayAmount;

    // Ensure score doesn't go below minimum
    return Math.max(score, DECAY_SETTINGS.minimumScore);
  } catch (error) {
    console.error("[ActivityScorer] Error calculating total score:", error);
    return 30;
  }
}

/**
 * Get all active penalties for a user
 */
async function getUserPenalties(userId) {
  try {
    const penalties = [];

    // Check for payment defaults/cancellations
    const Subscription = require("../subscription");
    const cancelledSubs = await Subscription.find({
      user_id: userId,
      status: "cancelled",
      cancellationReason: {
        $in: [
          "Payment failed",
          "Payment default",
          "Trial period expired - no payment received",
          "Trial period expired - payment required date passed",
        ],
      },
    });

    if (cancelledSubs.length > 0) {
      penalties.push({
        type: "paymentDefault",
        amount: PENALTIES.paymentDefault * cancelledSubs.length,
        count: cancelledSubs.length,
        timestamp: new Date(),
      });
    }

    // Check for regular cancellations
    const regularCancellations = await Subscription.countDocuments({
      user_id: userId,
      status: "cancelled",
      cancellationReason: {
        $nin: [
          "Payment failed",
          "Payment default",
          "Trial period expired - no payment received",
          "Trial period expired - payment required date passed",
        ],
      },
    });

    if (regularCancellations > 0) {
      penalties.push({
        type: "paymentCancellation",
        amount: PENALTIES.paymentCancellation * regularCancellations,
        count: regularCancellations,
        timestamp: new Date(),
      });
    }

    // Check for flagged messages
    const Message = require("../message");
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const flaggedMessages = await Message.countDocuments({
      sender_id: userId,
      status: "flagged",
      createdAt: { $gte: thirtyDaysAgo },
    });

    const user = await User.findById(userId);
    const confirmedFlaggedCount = user?.flaggedMessageCount || 0;
    const effectiveFlaggedCount = flaggedMessages + confirmedFlaggedCount;

    if (effectiveFlaggedCount > 0) {
      let messagesPenalty = PENALTIES.flaggedMessage * effectiveFlaggedCount;

      // Extra penalty for multiple flags
      if (effectiveFlaggedCount >= 3) {
        messagesPenalty += PENALTIES.multipleFlags;
      }

      penalties.push({
        type: "flaggedMessages",
        amount: messagesPenalty,
        count: effectiveFlaggedCount,
        timestamp: new Date(),
      });
    }

    // Check for account suspension
    if (user && user.isSuspended) {
      penalties.push({
        type: "accountSuspension",
        amount: PENALTIES.accountSuspension,
        timestamp: new Date(),
      });
    }

    // Check for abuse reports
    if (user && user.abuseReportCount && user.abuseReportCount > 0) {
      penalties.push({
        type: "reportedAbuse",
        amount: PENALTIES.reportedAbuse * user.abuseReportCount,
        count: user.abuseReportCount,
        timestamp: new Date(),
      });
    }

    return penalties;
  } catch (error) {
    console.error("[ActivityScorer] Error getting penalties:", error);
    return [];
  }
}

/**
 * Get user's last active timestamp
 */
async function getLastActiveDate(userId) {
  try {
    // Check last message
    const Message = require("../message");
    const lastMessage = await Message.findOne({ sender_id: userId })
      .sort({ createdAt: -1 })
      .lean();

    let lastActive = new Date(0);

    if (lastMessage) {
      lastActive = new Date(Math.max(lastActive, lastMessage.createdAt));
    }

    // Check user's lastLogin
    const user = await User.findById(userId).select("lastLogin");
    if (user && user.lastLogin) {
      lastActive = new Date(Math.max(lastActive, user.lastLogin));
    }

    return lastActive;
  } catch (error) {
    console.error("[ActivityScorer] Error getting last active date:", error);
    return new Date(0);
  }
}

/**
 * Calculate inactivity decay penalty
 * Loses 10% per month of inactivity
 */
function calculateInactivityDecay(lastActiveDate) {
  const now = new Date();
  const inactiveDays = Math.floor(
    (now - lastActiveDate) / (24 * 60 * 60 * 1000)
  );

  if (inactiveDays < 7) {
    return 0; // No decay in first week
  }

  const monthsInactive = inactiveDays / 30;
  const decayPercent = DECAY_SETTINGS.monthlyDecayPercent * monthsInactive;
  const maxDecay = 100 - DECAY_SETTINGS.minimumScore; // Max 80 points can be lost

  return Math.min(Math.floor(decayPercent), maxDecay);
}

/**
 * Record a payment violation
 */
async function recordPaymentViolation(userId, type = "default") {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    if (!user.violationHistory) {
      user.violationHistory = [];
    }

    user.violationHistory.push({
      type: type, // 'default' or 'cancellation'
      timestamp: new Date(),
    });

    user.violationCount = (user.violationCount || 0) + 1;

    // Suspend after 3 violations in 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentViolations = user.violationHistory.filter(
      (v) => v.timestamp > ninetyDaysAgo
    );

    if (recentViolations.length >= 3) {
      user.isSuspended = true;
      user.suspensionReason = "Multiple payment defaults";
    }

    await user.save();
  } catch (error) {
    console.error("[ActivityScorer] Error recording payment violation:", error);
  }
}

/**
 * Record a flagged message violation
 */
async function recordFlaggedMessage(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    user.flaggedMessageCount = (user.flaggedMessageCount || 0) + 1;

    // Suspend after 5 flagged messages in 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const Message = require("../message");

    const recentFlaggedMessages = await Message.countDocuments({
      sender_id: userId,
      status: "flagged",
      createdAt: { $gte: thirtyDaysAgo },
    });

    if (recentFlaggedMessages >= 5) {
      user.isSuspended = true;
      user.suspensionReason = "Multiple suspicious messages detected";
    }

    await user.save();
  } catch (error) {
    console.error("[ActivityScorer] Error recording flagged message:", error);
  }
}

/**
 * Manually suspend user account
 */
async function suspendUserAccount(userId, reason) {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        isSuspended: true,
        suspensionReason: reason,
        suspensionDate: new Date(),
      },
      { new: true }
    );

    return user;
  } catch (error) {
    console.error("[ActivityScorer] Error suspending user:", error);
  }
}

/**
 * Unsuspend user account
 */
async function unsuspendUserAccount(userId) {
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      {
        isSuspended: false,
        suspensionReason: null,
        suspensionDate: null,
      },
      { new: true }
    );

    return user;
  } catch (error) {
    console.error("[ActivityScorer] Error unsuspending user:", error);
  }
}

/**
 * Get activity report for user
 */
async function getActivityReport(userId) {
  try {
    const baseScore = await calculateBaseActivityScore(userId);
    const totalScore = await calculateTotalActivityScore(userId);
    const penalties = await getUserPenalties(userId);
    const lastActive = await getLastActiveDate(userId);

    return {
      userId,
      baseScore,
      totalScore,
      penalties,
      lastActive,
      scoreDropPercentage:
        baseScore > 0
          ? Math.round(((baseScore - totalScore) / baseScore) * 100)
          : 0,
      riskLevel:
        totalScore > 70 ? "LOW" : totalScore > 40 ? "MEDIUM" : "HIGH",
    };
  } catch (error) {
    console.error("[ActivityScorer] Error getting activity report:", error);
    return null;
  }
}

module.exports = {
  calculateBaseActivityScore,
  calculateTotalActivityScore,
  getUserPenalties,
  recordPaymentViolation,
  recordFlaggedMessage,
  suspendUserAccount,
  unsuspendUserAccount,
  getActivityReport,
  PENALTIES,
  ACTIVITY_THRESHOLDS,
};

const mongoose = require("mongoose");

/**
 * User Notification Preferences
 * Comprehensive schema covering all notification types and channels
 */
const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // ============================================
    // AUTHENTICATION NOTIFICATIONS
    // ============================================
    auth: {
      signup: {
        type: Boolean,
        default: true,
      },
      login: {
        type: Boolean,
        default: false,
      },
      logout: {
        type: Boolean,
        default: false,
      },
      passwordReset: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      passwordResetCompleted: {
        type: Boolean,
        default: true,
      },
      emailVerification: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      twoFactorSetup: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      twoFactorLogin: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      securityAlert: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
    },

    // ============================================
    // PAYMENT & SUBSCRIPTION NOTIFICATIONS
    // ============================================
    payment: {
      initialized: {
        type: Boolean,
        default: false,
      },
      success: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      failed: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      reminder: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      cancelled: {
        type: Boolean,
        default: true,
      },
      refund: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
    },

    // ============================================
    // TRIAL & SUBSCRIPTION NOTIFICATIONS
    // ============================================
    trial: {
      reminder: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      daysLeft7: {
        type: Boolean,
        default: true,
      },
      daysLeft3: {
        type: Boolean,
        default: true,
      },
      daysLeft1: {
        type: Boolean,
        default: true,
      },
      convertedToSubscription: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      expiringNotice: {
        type: Boolean,
        default: true,
      },
    },

    subscription: {
      activated: {
        type: Boolean,
        default: true,
      },
      cancelled: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      renewalReminder: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      renewalFailed: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      planUpgrade: {
        type: Boolean,
        default: true,
      },
      planDowngrade: {
        type: Boolean,
        default: true,
      },
    },

    // ============================================
    // ACTIVITY & MATCHING NOTIFICATIONS
    // ============================================
    activity: {
      newMatch: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      interestExpressed: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      newMessage: {
        type: Boolean,
        default: true, // Important - keep on by default
      },
      matchArchived: {
        type: Boolean,
        default: false,
      },
      profileCompleted: {
        type: Boolean,
        default: true,
      },
      profileUpdated: {
        type: Boolean,
        default: false,
      },
    },

    // ============================================
    // CHANNEL PREFERENCES (HOW to notify)
    // ============================================
    channels: {
      email: {
        type: Boolean,
        default: true,
      },
      sms: {
        type: Boolean,
        default: false, // Default to off - user must opt-in
      },
      push: {
        type: Boolean,
        default: false, // Default to off - user must opt-in
      },
    },

    // ============================================
    // FREQUENCY & DIGEST OPTIONS
    // ============================================
    frequency: {
      emailDigest: {
        type: String,
        enum: ["immediate", "daily", "weekly", "never"],
        default: "immediate",
      },
      smsDigest: {
        type: String,
        enum: ["immediate", "daily", "weekly", "never"],
        default: "daily",
      },
      pushDigest: {
        type: String,
        enum: ["immediate", "daily", "weekly", "never"],
        default: "immediate",
      },
    },

    // ============================================
    // QUIET HOURS (Do not disturb)
    // ============================================
    quietHours: {
      enabled: {
        type: Boolean,
        default: false,
      },
      startTime: {
        type: String, // Format: "HH:mm" e.g., "22:00"
        default: "22:00",
      },
      endTime: {
        type: String, // Format: "HH:mm" e.g., "08:00"
        default: "08:00",
      },
      timezone: {
        type: String,
        default: "UTC",
      },
      respectForSms: {
        type: Boolean,
        default: true,
      },
      respectForPush: {
        type: Boolean,
        default: true,
      },
    },

    // ============================================
    // METADATA
    // ============================================
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
    lastModifiedBy: {
      type: String,
      default: "user",
    },
  },
  {
    timestamps: true,
  },
);

// Index for fast queries
notificationPreferenceSchema.index({ userId: 1, createdAt: -1 });

// Static method to get or create preferences for a user
notificationPreferenceSchema.statics.getOrCreate = async function (userId) {
  let prefs = await this.findOne({ userId });

  if (!prefs) {
    prefs = await this.create({ userId });
  }

  return prefs;
};

// Instance method to check if a specific notification should be sent
notificationPreferenceSchema.methods.shouldNotify = function (
  eventType,
  channel = "email",
) {
  // Check if channel is enabled
  if (!this.channels[channel]) {
    return false;
  }

  // Parse event type like "auth.password_reset_requested"
  const [category, event] = eventType.split(".");

  // Get the preference for this event
  if (this[category] && this[category][toCamelCase(event)] !== undefined) {
    return this[category][toCamelCase(event)];
  }

  // Default to true if not found (erring on side of sending)
  return true;
};

// Instance method to check if currently in quiet hours
notificationPreferenceSchema.methods.isInQuietHours = function () {
  if (!this.quietHours.enabled) {
    return false;
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Simple time comparison (doesn't handle timezone properly - TODO: use moment-timezone)
  if (this.quietHours.endTime > this.quietHours.startTime) {
    // Normal hours (e.g., 22:00 - 08:00 across midnight)
    return (
      currentTime >= this.quietHours.startTime ||
      currentTime < this.quietHours.endTime
    );
  } else {
    // Hours that span midnight
    return (
      currentTime >= this.quietHours.startTime &&
      currentTime < this.quietHours.endTime
    );
  }
};

// Helper function to convert snake_case to camelCase
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

const NotificationPreference = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);

module.exports = NotificationPreference;

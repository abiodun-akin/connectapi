const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        "LOGIN",
        "LOGOUT",
        "SIGNUP",
        "PASSWORD_RESET",
        "EMAIL_VERIFICATION",
        "PROFILE_UPDATE",
        "LISTING_CREATE",
        "LISTING_UPDATE",
        "LISTING_DELETE",
        "MESSAGE_SEND",
        "PAYMENT_INITIATE",
        "PAYMENT_COMPLETE",
        "SUBSCRIPTION_CREATE",
        "SUBSCRIPTION_UPDATE",
        "ADMIN_ACTION",
        "SOCIAL_LOGIN",
        "FILE_UPLOAD",
        "NOTIFICATION_SEND",
        "SMS_SEND",
        "PUSH_SEND",
      ],
      index: true,
    },
    resource: {
      type: String,
      enum: [
        "USER",
        "PROFILE",
        "LISTING",
        "MESSAGE",
        "PAYMENT",
        "SUBSCRIPTION",
        "ADMIN",
        "FILE",
        "NOTIFICATION",
      ],
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    details: {
      type: mongoose.Schema.Types.Mixed, // Flexible object for action-specific data
    },
    ipAddress: String,
    userAgent: String,
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    success: {
      type: Boolean,
      default: true,
    },
    errorMessage: String,
  },
  {
    timestamps: true,
  },
);

// Compound indexes for efficient queries
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ resource: 1, resourceId: 1, timestamp: -1 });

// Static method to log an action
auditLogSchema.statics.logAction = async function (data) {
  try {
    const log = new this(data);
    await log.save();
    return log;
  } catch (error) {
    console.error("Failed to log audit action:", error);
    // Don't throw error to avoid breaking main functionality
  }
};

// Static method to get user activity
auditLogSchema.statics.getUserActivity = function (userId, limit = 50) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate("userId", "name email");
};

// Static method to get recent actions by type
auditLogSchema.statics.getRecentActions = function (action, limit = 100) {
  return this.find({ action })
    .sort({ timestamp: -1 })
    .limit(limit)
    .populate("userId", "name email");
};

module.exports = mongoose.model("AuditLog", auditLogSchema);

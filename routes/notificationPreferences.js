const express = require("express");
const router = express.Router();
const NotificationPreference = require("../notificationPreference");
const UserProfile = require("../userProfile");
const AuditLog = require("../auditLog");
const { ValidationError } = require("../errors/AppError");

/**
 * GET /api/notification-preferences
 * Get user's notification preferences
 */
router.get("/", async (req, res, next) => {
  try {
    const preferences = await NotificationPreference.getOrCreate(req.user._id);
    res.json(preferences);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notification-preferences
 * Update user's notification preferences (partial or complete)
 */
router.put("/", async (req, res, next) => {
  try {
    const updateData = req.body;

    // Validate the structure of updates
    validatePreferencesUpdate(updateData);

    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      {
        ...updateData,
        lastUpdatedAt: new Date(),
        lastModifiedBy: "user",
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({
      message: "Notification preferences updated successfully",
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notification-preferences/channel/:channel
 * Toggle a specific channel on/off (email, sms, push)
 */
router.put("/channel/:channel", async (req, res, next) => {
  try {
    const { channel } = req.params;
    const { enabled } = req.body;

    if (!["email", "sms", "push"].includes(channel)) {
      throw new ValidationError(`Invalid channel: ${channel}`, "channel");
    }

    if (typeof enabled !== "boolean") {
      throw new ValidationError("enabled must be a boolean", "enabled");
    }

    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      {
        [`channels.${channel}`]: enabled,
        lastUpdatedAt: new Date(),
        lastModifiedBy: "user",
      },
      { new: true, upsert: true },
    );

    res.json({
      message: `${channel} notifications ${enabled ? "enabled" : "disabled"}`,
      channel,
      enabled,
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notification-preferences/event/:eventType/:category
 * Toggle a specific event notification
 * Example: PUT /api/notification-preferences/event/password_reset/auth
 */
router.put("/event/:category/:event", async (req, res, next) => {
  try {
    const { category, event } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      throw new ValidationError("enabled must be a boolean", "enabled");
    }

    // Validate category exists
    const validCategories = [
      "auth",
      "payment",
      "trial",
      "subscription",
      "activity",
    ];
    if (!validCategories.includes(category)) {
      throw new ValidationError(
        `Invalid category. Must be one of: ${validCategories.join(", ")}`,
        "category",
      );
    }

    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      {
        [`${category}.${toCamelCase(event)}`]: enabled,
        lastUpdatedAt: new Date(),
        lastModifiedBy: "user",
      },
      { new: true, upsert: true, runValidators: true },
    );

    if (!preferences) {
      throw new Error("Failed to update preferences");
    }

    res.json({
      message: `${category}.${event} notification ${enabled ? "enabled" : "disabled"}`,
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notification-preferences/quiet-hours
 * Update quiet hours settings
 */
router.put("/quiet-hours", async (req, res, next) => {
  try {
    const {
      enabled,
      startTime,
      endTime,
      timezone,
      respectForSms,
      respectForPush,
    } = req.body;

    // Validate time format (HH:mm)
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
      throw new ValidationError(
        "startTime must be in HH:mm format",
        "startTime",
      );
    }
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) {
      throw new ValidationError("endTime must be in HH:mm format", "endTime");
    }

    const updateData = {};
    if (enabled !== undefined) updateData["quietHours.enabled"] = enabled;
    if (startTime) updateData["quietHours.startTime"] = startTime;
    if (endTime) updateData["quietHours.endTime"] = endTime;
    if (timezone) updateData["quietHours.timezone"] = timezone;
    if (respectForSms !== undefined)
      updateData["quietHours.respectForSms"] = respectForSms;
    if (respectForPush !== undefined)
      updateData["quietHours.respectForPush"] = respectForPush;

    const preferences = await NotificationPreference.findOneAndUpdate(
      { userId: req.user._id },
      {
        ...updateData,
        lastUpdatedAt: new Date(),
        lastModifiedBy: "user",
      },
      { new: true, upsert: true },
    );

    res.json({
      message: "Quiet hours updated successfully",
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/notification-preferences/reset
 * Reset all preferences to defaults
 */
router.put("/reset", async (req, res, next) => {
  try {
    await NotificationPreference.deleteOne({ userId: req.user._id });

    const preferences = await NotificationPreference.getOrCreate(req.user._id);

    res.json({
      message: "Notification preferences reset to defaults",
      preferences,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/notification-preferences/fcm-token
 * Register FCM token for push notifications
 */
router.post("/fcm-token", async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      throw new ValidationError("Valid FCM token is required", "token");
    }

    const profile = await UserProfile.findOneAndUpdate(
      { user_id: req.user._id },
      { $addToSet: { fcmTokens: token } },
      { new: true, upsert: true },
    );

    // Log audit event
    await AuditLog.logAction({
      userId: req.user._id,
      action: "NOTIFICATION_SEND",
      resource: "NOTIFICATION",
      details: {
        type: "fcm_token_registered",
        token: token.substring(0, 10) + "...", // Log partial token for security
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    res.json({
      message: "FCM token registered successfully",
      tokenCount: profile.fcmTokens?.length || 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/notification-preferences/fcm-token
 * Unregister FCM token
 */
router.delete("/fcm-token", async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      throw new ValidationError("Valid FCM token is required", "token");
    }

    const profile = await UserProfile.findOneAndUpdate(
      { user_id: req.user._id },
      { $pull: { fcmTokens: token } },
      { new: true },
    );

    // Log audit event
    await AuditLog.logAction({
      userId: req.user._id,
      action: "NOTIFICATION_SEND",
      resource: "NOTIFICATION",
      details: {
        type: "fcm_token_unregistered",
        token: token.substring(0, 10) + "...", // Log partial token for security
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    res.json({
      message: "FCM token unregistered successfully",
      tokenCount: profile?.fcmTokens?.length || 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Helper: Validate preferences update structure
 */
function validatePreferencesUpdate(data) {
  const validTopLevelKeys = [
    "auth",
    "payment",
    "trial",
    "subscription",
    "activity",
    "channels",
    "frequency",
    "quietHours",
  ];

  for (const key of Object.keys(data)) {
    if (!validTopLevelKeys.includes(key)) {
      throw new ValidationError(
        `Invalid preference key: ${key}. Must be one of: ${validTopLevelKeys.join(", ")}`,
        key,
      );
    }
  }
}

/**
 * Helper: Convert snake_case to camelCase
 */
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

module.exports = router;

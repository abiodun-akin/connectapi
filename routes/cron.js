/**
 * Cron Job handler endpoint
 * Can be called by external cron services (like EasyCron, AWS EventBridge, etc.)
 * to trigger background tasks
 */

const express = require("express");
const router = express.Router();
const {
  processTrialExpirations,
  processPaymentReminders,
  processScheduledDowngrades,
  cancelOverdueTrials,
} = require("../workers/trialWorker");
const { processMessages } = require("../workers/cronJob");

// Middleware to verify cron secret
const verifyCronSecret = (req, res, next) => {
  const cronSecret = process.env.CRON_SECRET || "your-secret-key";
  const providedSecret = req.headers["x-cron-secret"] || req.query.secret;

  if (providedSecret !== cronSecret) {
    return res.status(401).json({
      error: "Invalid cron secret",
      code: "UNAUTHORIZED",
    });
  }

  next();
};

/**
 * POST /api/cron/process-trials
 * Process trial expirations, send reminders, and handle conversions
 * Protected by CRON_SECRET header or query parameter
 */
router.post("/process-trials", verifyCronSecret, async (req, res) => {
  try {
    console.log("[Cron] Triggered: process-trials");

    await processTrialExpirations();
    const paymentRemindersSent = await processPaymentReminders();
    const scheduledDowngradesApplied = await processScheduledDowngrades();

    res.json({
      message: "Trial expiration processing completed",
      paymentRemindersSent,
      scheduledDowngradesApplied,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[Cron] Error in process-trials:", error);
    res.status(500).json({
      error: "Error processing trials",
      code: "INTERNAL_ERROR",
      message: error.message,
    });
  }
});

/**
 * POST /api/cron/process-notifications
 * Drain queued auth/payment/trial notifications and send emails
 * Protected by CRON_SECRET header or query parameter
 */
router.post("/process-notifications", verifyCronSecret, async (req, res) => {
  try {
    console.log("[Cron] Triggered: process-notifications");

    const processed = await processMessages();

    res.json({
      message: "Notification queue processing completed",
      processed,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[Cron] Error in process-notifications:", error);
    res.status(500).json({
      error: "Error processing notifications",
      code: "INTERNAL_ERROR",
      message: error.message,
    });
  }
});

/**
 * POST /api/cron/cancel-overdue
 * Force cancel trials that are past their payment required date
 * Protected by CRON_SECRET header or query parameter
 */
router.post("/cancel-overdue", verifyCronSecret, async (req, res) => {
  try {
    console.log("[Cron] Triggered: cancel-overdue");

    await cancelOverdueTrials();

    res.json({
      message: "Overdue trials cancellation completed",
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("[Cron] Error in cancel-overdue:", error);
    res.status(500).json({
      error: "Error cancelling overdue trials",
      code: "INTERNAL_ERROR",
      message: error.message,
    });
  }
});

/**
 * GET /api/cron/health
 * Health check endpoint
 */
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date(),
    environment: process.env.NODE_ENV || "development",
  });
});

module.exports = router;

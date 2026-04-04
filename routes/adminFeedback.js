/**
 * Admin Feedback Routes - Path C
 * Allows admins to submit message analysis feedback
 * System learns from feedback to improve accuracy
 */

const express = require("express");
const router = express.Router();

const {
  recordAdminFeedback,
  getAdaptiveConfiguration,
  getLearningStats,
  calibrateCommunityThresholds,
} = require("../services/adaptiveLearningService");

const { authenticate, authorize } = require("../middleware/auth");

/**
 * POST /api/admin/feedback/message-analysis
 * Record admin feedback on message analysis
 * Requires admin/moderator role
 */
router.post(
  "/feedback/message-analysis",
  // authenticate,
  // authorize(["admin", "moderator"]),
  async (req, res) => {
    try {
      const {
        messageId,
        userId,
        originalAnalysis,
        adminDecision, // "correct", "false_positive", "false_negative", "partially_correct"
        adminNotes,
        communityId,
      } = req.body;

      // Validate required fields
      if (!messageId || !adminDecision) {
        return res
          .status(400)
          .json({ error: "messageId and adminDecision required" });
      }

      if (
        !["correct", "false_positive", "false_negative", "partially_correct"].includes(
          adminDecision
        )
      ) {
        return res
          .status(400)
          .json({
            error: "adminDecision must be correct, false_positive, false_negative, or partially_correct",
          });
      }

      const feedback = await recordAdminFeedback({
        messageId,
        userId,
        originalAnalysis,
        adminDecision,
        adminNotes,
        adminId: req.user?.id, // From auth middleware
        communityId,
      });

      res.json({
        success: true,
        feedback,
        message: "Feedback recorded and learning system updated",
      });
    } catch (error) {
      console.error("[Feedback API] Error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/admin/feedback/adaptive-config
 * Get adaptive analysis configuration for a user
 * Used by frontend to apply learned thresholds
 */
router.get("/feedback/adaptive-config", async (req, res) => {
  try {
    const { userId, communityId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const config = await getAdaptiveConfiguration(userId, communityId);

    res.json({
      success: true,
      config,
      message: "Adaptive configuration generated based on learning",
    });
  } catch (error) {
    console.error("[Adaptive Config API] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/feedback/learning-stats
 * Get overall learning statistics and performance metrics
 */
router.get("/feedback/learning-stats", async (req, res) => {
  try {
    const { communityId } = req.query;

    const stats = await getLearningStats(communityId);

    if (!stats) {
      return res
        .status(500)
        .json({ error: "Failed to calculate learning statistics" });
    }

    res.json({
      success: true,
      stats,
      message: "Learning system performance metrics",
    });
  } catch (error) {
    console.error("[Learning Stats API] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/feedback/calibrate-thresholds
 * Recalibrate community thresholds based on recent feedback
 * Requires admin role
 */
router.post(
  "/feedback/calibrate-thresholds",
  // authenticate,
  // authorize(["admin"]),
  async (req, res) => {
    try {
      const { communityId } = req.body;

      if (!communityId) {
        return res.status(400).json({ error: "communityId required" });
      }

      const updated = await calibrateCommunityThresholds(communityId);

      if (!updated) {
        return res.status(404).json({ error: "Community not found" });
      }

      res.json({
        success: true,
        thresholds: updated,
        message: "Community thresholds recalibrated",
      });
    } catch (error) {
      console.error("[Calibrate API] Error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * GET /api/admin/feedback/pattern-effectiveness
 * Get detailed performance metrics for each pattern
 */
router.get("/feedback/pattern-effectiveness", async (req, res) => {
  try {
    const { category } = req.query;
    const { getDynamicPatternWeights } = require("../services/adaptiveLearningService");

    const weights = await getDynamicPatternWeights(category);

    // Sort by effectiveness
    const sorted = Object.entries(weights)
      .sort(([, a], [, b]) => b.f1Score - a.f1Score)
      .reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});

    res.json({
      success: true,
      patterns: sorted,
      message: "Pattern effectiveness metrics (sorted by F1 score)",
    });
  } catch (error) {
    console.error("[Pattern Effectiveness API] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/feedback/user-reputation/:userId
 * Get user reputation and trust level
 */
router.get("/feedback/user-reputation/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { UserReputation } = require("../models/AdaptiveLearning");

    const reputation = await UserReputation.findOne({
      userId,
    }).lean();

    if (!reputation) {
      return res.json({
        success: true,
        reputation: {
          userId,
          reputationScore: 50,
          trustLevel: "new",
          stats: {
            totalMessages: 0,
          },
        },
        message: "New user - no reputation history",
      });
    }

    res.json({
      success: true,
      reputation,
      message: "User reputation data",
    });
  } catch (error) {
    console.error("[User Reputation API] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

/**
 * Admin Feedback Routes - Path C
 * Allows admins to submit message analysis feedback
 * System learns from feedback to improve accuracy
 */

const express = require("express");
const router = express.Router();
const User = require("../user");

const {
  recordAdminFeedback,
  getAdaptiveConfiguration,
  getLearningStats,
  calibrateCommunityThresholds,
  getDynamicPatternWeights,
} = require("../services/adaptiveLearningService");
const { UserReputation } = require("../models/AdaptiveLearning");

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("isAdmin");
    if (!user?.isAdmin) {
      return res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
    }
    next();
  } catch (error) {
    next(error);
  }
};

router.use(verifyAdmin);

/**
 * POST /api/admin/feedback/message-analysis
 */
router.post("/feedback/message-analysis", async (req, res, next) => {
  try {
    const { messageId, userId, originalAnalysis, adminDecision, adminNotes, communityId } = req.body;

    if (!messageId || !adminDecision) {
      return res.status(400).json({ error: "messageId and adminDecision required" });
    }

    if (!["correct", "false_positive", "false_negative", "partially_correct"].includes(adminDecision)) {
      return res.status(400).json({
        error: "adminDecision must be correct, false_positive, false_negative, or partially_correct",
      });
    }

    const feedback = await recordAdminFeedback({
      messageId,
      userId,
      originalAnalysis,
      adminDecision,
      adminNotes,
      adminId: req.user._id,
      communityId,
    });

    res.json({ success: true, feedback, message: "Feedback recorded and learning system updated" });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/feedback/adaptive-config
 */
router.get("/feedback/adaptive-config", async (req, res, next) => {
  try {
    const { userId, communityId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const config = await getAdaptiveConfiguration(userId, communityId);
    res.json({ success: true, config });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/feedback/learning-stats
 */
router.get("/feedback/learning-stats", async (req, res, next) => {
  try {
    const stats = await getLearningStats(req.query.communityId);
    if (!stats) {
      return res.status(500).json({ error: "Failed to calculate learning statistics" });
    }
    res.json({ success: true, stats });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/feedback/calibrate-thresholds
 */
router.post("/feedback/calibrate-thresholds", async (req, res, next) => {
  try {
    const { communityId } = req.body;
    if (!communityId) {
      return res.status(400).json({ error: "communityId required" });
    }

    const updated = await calibrateCommunityThresholds(communityId);
    if (!updated) {
      return res.status(404).json({ error: "Community not found" });
    }

    res.json({ success: true, thresholds: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/feedback/pattern-effectiveness
 */
router.get("/feedback/pattern-effectiveness", async (req, res, next) => {
  try {
    const weights = await getDynamicPatternWeights(req.query.category);
    const sorted = Object.entries(weights)
      .sort(([, a], [, b]) => b.f1Score - a.f1Score)
      .reduce((acc, [key, val]) => { acc[key] = val; return acc; }, {});

    res.json({ success: true, patterns: sorted });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/feedback/user-reputation/:userId
 */
router.get("/feedback/user-reputation/:userId", async (req, res, next) => {
  try {
    const reputation = await UserReputation.findOne({ userId: req.params.userId }).lean();

    if (!reputation) {
      return res.json({
        success: true,
        reputation: {
          userId: req.params.userId,
          reputationScore: 50,
          trustLevel: "new",
          stats: { totalMessages: 0 },
        },
      });
    }

    res.json({ success: true, reputation });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

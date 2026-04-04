/**
 * Adaptive Learning Service - Path C
 * Processes admin feedback and learns from moderation decisions
 * Continuously improves pattern effectiveness and user reputation
 */

const {
  AnalysisFeedback,
  PatternEffectiveness,
  UserReputation,
  CommunityThresholds,
} = require("../models/AdaptiveLearning");

/**
 * Record admin feedback on message analysis
 * Called when admin reviews a flagged/unflagged message
 */
async function recordAdminFeedback(data) {
  const {
    messageId,
    userId,
    originalAnalysis,
    adminDecision, // "correct", "false_positive", "false_negative", "partially_correct"
    adminNotes,
    adminId,
    communityId,
  } = data;

  try {
    // Save feedback
    const feedback = await AnalysisFeedback.create({
      messageId,
      originalAnalysis,
      adminDecision,
      adminNotes,
      adminId,
      userContext: {
        userId,
        userReputation: await getUserReputation(userId),
      },
    });

    // Process learning
    await processAdminFeedback(feedback, originalAnalysis, adminDecision);

    // Update user reputation
    await updateUserReputation(userId, adminDecision);

    // Update community statistics
    if (communityId) {
      await updateCommunityStats(communityId, adminDecision);
    }

    return feedback;
  } catch (error) {
    console.error("[Learning] Failed to record feedback:", error.message);
    throw error;
  }
}

/**
 * Process admin feedback to learn from pattern effectiveness
 */
async function processAdminFeedback(
  feedback,
  originalAnalysis,
  adminDecision
) {
  const { flaggedPatterns } = originalAnalysis;

  if (!flaggedPatterns || flaggedPatterns.length === 0) {
    return;
  }

  for (const pattern of flaggedPatterns) {
    const patternKey = pattern.pattern || pattern;

    try {
      let patternRecord = await PatternEffectiveness.findOne({
        pattern: patternKey,
      });

      if (!patternRecord) {
        patternRecord = await PatternEffectiveness.create({
          pattern: patternKey,
          category: pattern.category,
        });
      }

      // Update stats based on admin decision
      patternRecord.stats.totalDetections += 1;

      if (adminDecision === "correct" || adminDecision === "partially_correct") {
        patternRecord.stats.confirmedAccurate += 1;
      } else if (adminDecision === "false_positive") {
        patternRecord.stats.falsePositives += 1;
      } else if (adminDecision === "false_negative") {
        patternRecord.stats.falseNegatives += 1;
      }

      // Recalculate metrics
      await recalculatePatternMetrics(patternRecord);

      // Update recommended weight based on effectiveness
      patternRecord.recommendedWeight = calculateRecommendedWeight(
        patternRecord
      );

      await patternRecord.save();
    } catch (error) {
      console.error(
        `[Learning] Failed to update pattern ${patternKey}:`,
        error.message
      );
    }
  }
}

/**
 * Calculate metrics: Precision, Recall, F1 Score
 */
async function recalculatePatternMetrics(patternRecord) {
  const { totalDetections, confirmedAccurate, falsePositives, falseNegatives } =
    patternRecord.stats;

  // Precision: Of all patterns we flagged, how many were correct?
  const precision =
    totalDetections > 0 ? confirmedAccurate / totalDetections : 0;

  // Recall: Of all actual scams, how many did we catch?
  const totalActualScams = confirmedAccurate + falseNegatives;
  const recall = totalActualScams > 0 ? confirmedAccurate / totalActualScams : 0;

  // F1 Score: Harmonic mean of precision and recall
  const f1Score =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  patternRecord.precision = parseFloat(precision.toFixed(3));
  patternRecord.recall = parseFloat(recall.toFixed(3));
  patternRecord.f1Score = parseFloat(f1Score.toFixed(3));

  patternRecord.lastUpdated = new Date();
}

/**
 * Calculate recommended weight based on pattern effectiveness
 */
function calculateRecommendedWeight(patternRecord) {
  const { precision, recall, f1Score } = patternRecord;

  // Base weight (original value)
  const baseWeight = patternRecord.baseWeight || 15;

  // Adjust based on F1 score
  if (f1Score >= 0.9) {
    return baseWeight * 1.5; // Very effective, boost weight
  } else if (f1Score >= 0.7) {
    return baseWeight * 1.2; // Good, slight boost
  } else if (f1Score >= 0.5) {
    return baseWeight * 1.0; // Acceptable, keep baseline
  } else if (f1Score >= 0.3) {
    return baseWeight * 0.7; // Weak, reduce weight
  } else {
    return baseWeight * 0.3; // Poor, significantly reduce
  }
}

/**
 * Retrieve dynamic pattern weights based on learning
 */
async function getDynamicPatternWeights(category = null) {
  const query = category ? { category } : {};
  const patterns = await PatternEffectiveness.find(query);

  const weights = {};
  patterns.forEach((p) => {
    weights[p.pattern] = {
      baseWeight: p.baseWeight,
      recommendedWeight: p.recommendedWeight,
      precision: p.precision,
      recall: p.recall,
      f1Score: p.f1Score,
      effectiveness: calculateEffectivenessRating(p),
    };
  });

  return weights;
}

/**
 * Rate pattern effectiveness (A+, A, B+, B, C, F)
 */
function calculateEffectivenessRating(patternRecord) {
  const { f1Score, falsePositives } = patternRecord;

  if (f1Score >= 0.9 && falsePositives === 0) return "A+";
  if (f1Score >= 0.85) return "A";
  if (f1Score >= 0.75) return "B+";
  if (f1Score >= 0.65) return "B";
  if (f1Score >= 0.5) return "C";
  return "F";
}

/**
 * Update user reputation based on message history
 */
async function updateUserReputation(userId, adminDecision) {
  try {
    let rep = await UserReputation.findOne({
      userId,
    });

    if (!rep) {
      rep = await UserReputation.create({
        userId,
      });
    }

    // Update stats
    rep.stats.totalMessages += 1;

    if (adminDecision === "correct") {
      rep.stats.confirmedScams += 1;
    } else if (adminDecision === "false_positive") {
      rep.stats.falseFlags += 1;
    } else if (adminDecision === "false_negative") {
      // User sent legitimate message that we mistakenly flagged
      rep.stats.falseFlags += 1;
    } else if (adminDecision === "partially_correct") {
      rep.stats.confirmedScams += 0.5;
    } else {
      rep.stats.cleanMessages += 1;
    }

    // Recalculate reputation score
    calculateReputation(rep);

    // Determine trust level
    rep.trustLevel = determineTrustLevel(rep);

    // Set custom threshold for very trusted users
    if (rep.trustLevel === "verified") {
      rep.customRiskThreshold = 50; // Higher threshold = fewer flags
    } else if (rep.trustLevel === "trusted") {
      rep.customRiskThreshold = 40;
    } else if (rep.trustLevel === "new" || rep.stats.totalMessages < 5) {
      rep.customRiskThreshold = 30; // Lower threshold = more cautious
    }

    rep.lastActivityDate = new Date();
    await rep.save();

    return rep;
  } catch (error) {
    console.error(`[Learning] Failed to update user reputation:`, error);
    throw error;
  }
}

/**
 * Calculate reputation score (0-100)
 */
function calculateReputation(rep) {
  const {
    totalMessages,
    confirmedScams,
    falseFlags,
    cleanMessages,
  } = rep.stats;

  if (totalMessages === 0) {
    rep.reputationScore = 50;
    return;
  }

  // Base score is 50
  let score = 50;

  // Clean message ratio increases reputation
  const cleanRatio = cleanMessages / totalMessages;
  score += cleanRatio * 30;

  // False flags (bad for reputation)
  const falseFlagRatio = falseFlags / totalMessages;
  score -= falseFlagRatio * 40;

  // Confirmed scams (very bad)
  const scamRatio = confirmedScams / totalMessages;
  score -= scamRatio * 50;

  // Cap between 0-100
  rep.reputationScore = Math.max(0, Math.min(100, score));
}

/**
 * Determine trust level based on reputation
 */
function determineTrustLevel(rep) {
  const { totalMessages, reputationScore, falseFlags } = rep;

  if (totalMessages < 5) {
    return "new";
  }

  if (reputationScore >= 85 && falseFlags === 0 && totalMessages > 50) {
    return "verified"; // Long history, no false flags
  }

  if (reputationScore >= 75) {
    return "trusted";
  }

  if (reputationScore >= 60) {
    return "established";
  }

  if (reputationScore < 30) {
    return "flagged"; // Likely spammer/scammer
  }

  return "new";
}

/**
 * Get user reputation data
 */
async function getUserReputation(userId) {
  try {
    const rep = await UserReputation.findOne({
      userId,
    });
    return rep ? rep.reputationScore : 50;
  } catch (error) {
    console.error("[Learning] Failed to get user reputation:", error);
    return 50; // Default
  }
}

/**
 * Get adaptive analysis configuration for a user/community
 */
async function getAdaptiveConfiguration(userId, communityId) {
  try {
    // Get user reputation
    const userRep = await UserReputation.findOne({
      userId,
    });

    // Get community thresholds
    let communityConfig = null;
    if (communityId) {
      communityConfig = await CommunityThresholds.findOne({
        communityId,
      });
    }

    // Get dynamic pattern weights
    const patterns = await getDynamicPatternWeights();

    return {
      userReputation: userRep?.reputationScore || 50,
      userTrustLevel: userRep?.trustLevel || "new",
      customRiskThreshold: userRep?.customRiskThreshold,
      communityThresholds: communityConfig,
      patternWeights: patterns,
      contextFactors: {
        farmContext: 0.8, // Reduce false positives in farm context
        newUser: 1.2, // Be more cautious with new users
        trustedUser: userRep?.trustLevel === "verified" ? 0.5 : 1.0,
      },
    };
  } catch (error) {
    console.error("[Learning] Failed to get adaptive config:", error);
    return null; // Fall back to defaults
  }
}

/**
 * Calibrate community thresholds based on feedback
 */
async function calibrateCommunityThresholds(communityId) {
  try {
    const config = await CommunityThresholds.findOne({
      communityId,
    });

    if (!config) {
      return null;
    }

    // Analyze recent feedback to see if thresholds need adjustment
    const recentFeedback = await AnalysisFeedback.find({
      createdAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
    }).lean();

    if (recentFeedback.length === 0) {
      return config;
    }

    // Count false positives and false negatives
    const falsePositives = recentFeedback.filter(
      (f) => f.adminDecision === "false_positive"
    ).length;
    const falseNegatives = recentFeedback.filter(
      (f) => f.adminDecision === "false_negative"
    ).length;

    const totalReviewed = recentFeedback.length;
    const fpPercent = (falsePositives / totalReviewed) * 100;
    const fnPercent = (falseNegatives / totalReviewed) * 100;

    // Adjust thresholds if needed
    if (fpPercent > config.falsePositiveTolerancePercent) {
      config.baseSuspiciousThreshold += 5; // Raise threshold to reduce false positives
    } else if (fnPercent > config.falseNegativeTolerancePercent) {
      config.baseSuspiciousThreshold -= 5; // Lower threshold to catch more scams
    }

    config.lastCalibrated = new Date();
    await config.save();

    return config;
  } catch (error) {
    console.error("[Learning] Failed to calibrate thresholds:", error);
    return null;
  }
}

/**
 * Get learning statistics and performance metrics
 */
async function getLearningStats(communityId = null) {
  try {
    // Overall pattern effectiveness
    const patterns = await PatternEffectiveness.find({}).lean();

    // Calculate average effectiveness
    const avgF1 =
      patterns.length > 0
        ? (patterns.reduce((sum, p) => sum + p.f1Score, 0) / patterns.length).toFixed(3)
        : 0;

    // Pattern quality breakdown
    const qualityBreakdown = {
      "A+": patterns.filter((p) => p.f1Score >= 0.9 && p.stats.falsePositives === 0).length,
      A: patterns.filter((p) => p.f1Score >= 0.85).length,
      "B+": patterns.filter((p) => p.f1Score >= 0.75).length,
      B: patterns.filter((p) => p.f1Score >= 0.65).length,
      C: patterns.filter((p) => p.f1Score >= 0.5).length,
      F: patterns.filter((p) => p.f1Score < 0.5).length,
    };

    // User reputation distribution
    const userStats = await UserReputation.find({}).lean();
    const trustDistribution = {
      verified: userStats.filter((u) => u.trustLevel === "verified").length,
      trusted: userStats.filter((u) => u.trustLevel === "trusted").length,
      established: userStats.filter((u) => u.trustLevel === "established").length,
      new: userStats.filter((u) => u.trustLevel === "new").length,
      flagged: userStats.filter((u) => u.trustLevel === "flagged").length,
    };

    return {
      timestamp: new Date(),
      patternsAnalyzed: patterns.length,
      averageF1Score: parseFloat(avgF1),
      qualityBreakdown,
      totalUsers: userStats.length,
      trustDistribution,
      improvementPotential:
        patterns.filter((p) => p.f1Score < 0.7).length > 0
          ? `${patterns.filter((p) => p.f1Score < 0.7).length} patterns could be improved`
          : "All patterns performing well",
    };
  } catch (error) {
    console.error("[Learning] Failed to get stats:", error);
    return null;
  }
}

module.exports = {
  recordAdminFeedback,
  processAdminFeedback,
  updateUserReputation,
  getUserReputation,
  getAdaptiveConfiguration,
  getDynamicPatternWeights,
  calibrateCommunityThresholds,
  getLearningStats,
  recalculatePatternMetrics,
  calculateRecommendedWeight,
  determineTrustLevel,
  calculateReputation,
};

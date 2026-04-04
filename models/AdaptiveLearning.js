/**
 * Adaptive Learning System - Path C
 * Learns from admin moderation decisions to improve analyzer accuracy
 */

const mongoose = require("mongoose");

/**
 * Schema for tracking admin feedback on message analysis
 * Used to learn pattern effectiveness and adjust thresholds
 */
const analysisFeedbackSchema = new mongoose.Schema(
  {
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    originalAnalysis: {
      riskScore: Number,
      isSuspicious: Boolean,
      confidence: Number,
      method: String, // "gemini", "enhanced", "pattern_matching"
      flaggedPatterns: [String],
      detectedKeywords: [String],
    },
    adminDecision: {
      type: String,
      enum: ["correct", "false_positive", "false_negative", "partially_correct"],
      required: true,
    },
    adminNotes: String,
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Learning data
    patternsEffectiveness: {
      // Track which patterns were actually predictive
      correctPatterns: [String], // Patterns that correctly identified scams
      incorrectPatterns: [String], // Patterns that led to false positives
    },
    recommendedThreshold: {
      type: Number,
      min: 0,
      max: 100,
      description: "Admin's recommended risk threshold for this context",
    },
    userContext: {
      userId: mongoose.Schema.Types.ObjectId,
      userReputation: Number, // 0-100, high = trusted
      userHistory: {
        totalMessages: Number,
        flaggedMessages: Number,
        suspiciousMessages: Number,
      },
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Schema for pattern performance tracking
 * Aggregates feedback to measure pattern effectiveness
 */
const patternEffectivenessSchema = new mongoose.Schema(
  {
    pattern: {
      type: String,
      required: true,
      unique: true,
    },
    category: {
      type: String,
      enum: ["payment", "romance", "phishing", "spam"],
    },

    // Performance metrics
    stats: {
      totalDetections: { type: Number, default: 0 }, // Times pattern triggered
      confirmedAccurate: { type: Number, default: 0 }, // Times admin confirmed it was scam
      falsePositives: { type: Number, default: 0 }, // Times admin said it was safe
      falseNegatives: { type: Number, default: 0 }, // Times pattern missed a scam
    },

    // Calculated metrics
    precision: {
      type: Number,
      default: 0,
      description: "confirmedAccurate / totalDetections",
    }, // "When we flag this, how often is it correct?"
    recall: {
      type: Number,
      default: 0,
      description: "confirmedAccurate / (confirmedAccurate + falseNegatives)",
    }, // "How often do we catch this scam type?"
    f1Score: {
      type: Number,
      default: 0,
      description: "2 * (precision * recall) / (precision + recall)",
    }, // Harmonic mean

    // Adaptive weighting
    recommendedWeight: {
      type: Number,
      default: 15,
      min: 0,
      max: 50,
      description: "Weight this pattern should have based on effectiveness",
    },
    baseWeight: {
      type: Number,
      default: 15,
      description: "Original static weight",
    },

    // Context modifications
    contextFactors: {
      farmContext: { type: Number, default: 1.0 }, // Multiplier in farm context
      newUser: { type: Number, default: 1.2 }, // Multiplier for new users
      trustedUser: { type: Number, default: 0.6 }, // Multiplier for reputable users
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Schema for user reputation & history
 * Tracks user's message safety record
 */
const userReputationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    // Message history
    stats: {
      totalMessages: { type: Number, default: 0 },
      flaggedMessages: { type: Number, default: 0 },
      confirmedScams: { type: Number, default: 0 }, // Admin confirmed as scam
      falseFlags: { type: Number, default: 0 }, // Admin said it was safe
      cleanMessages: { type: Number, default: 0 }, // Never flagged
    },

    // Reputation score (0-100)
    reputationScore: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
    },

    // Trust level
    trustLevel: {
      type: String,
      enum: ["new", "established", "trusted", "verified", "flagged"],
      default: "new",
    },

    // Thresholds customized per user
    customRiskThreshold: {
      type: Number,
      min: 0,
      max: 100,
      description: "Custom risk threshold - trusted users can have higher threshold",
    },

    // Flags for manual review
    flaggedForReview: {
      type: Boolean,
      default: false,
    },
    reviewNotes: String,

    lastActivityDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Schema for community thresholds
 * Different communities may have different risk tolerance
 */
const communityThresholdsSchema = new mongoose.Schema(
  {
    communityId: {
      type: String,
      required: true,
      unique: true,
      description: "Region, platform section, or moderation group",
    },

    // Thresholds
    baseSuspiciousThreshold: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
      description: "Score above this = flag as suspicious",
    },
    criticalThreshold: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
      description: "Score above this = require admin review before action",
    },

    // Tolerance levels
    falsePositiveTolerancePercent: {
      type: Number,
      default: 3,
      min: 0,
      max: 100,
      description: "% acceptable false positive rate",
    },
    falseNegativeTolerancePercent: {
      type: Number,
      default: 1,
      min: 0,
      max: 100,
      description: "% acceptable false negative rate (missing scams)",
    },

    // Community stats
    stats: {
      totalMessages: { type: Number, default: 0 },
      confirmedScams: { type: Number, default: 0 },
      moderatorsActive: { type: Number, default: 0 },
    },

    lastCalibrated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Export models
const AnalysisFeedback =
  mongoose.models.AnalysisFeedback ||
  mongoose.model("AnalysisFeedback", analysisFeedbackSchema);

const PatternEffectiveness =
  mongoose.models.PatternEffectiveness ||
  mongoose.model("PatternEffectiveness", patternEffectivenessSchema);

const UserReputation =
  mongoose.models.UserReputation ||
  mongoose.model("UserReputation", userReputationSchema);

const CommunityThresholds =
  mongoose.models.CommunityThresholds ||
  mongoose.model("CommunityThresholds", communityThresholdsSchema);

module.exports = {
  AnalysisFeedback,
  PatternEffectiveness,
  UserReputation,
  CommunityThresholds,
  schemas: {
    analysisFeedbackSchema,
    patternEffectivenessSchema,
    userReputationSchema,
    communityThresholdsSchema,
  },
};

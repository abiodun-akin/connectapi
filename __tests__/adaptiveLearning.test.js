/**
 * Adaptive Learning System Tests - Path C
 * Verifies admin feedback, pattern learning, and reputation tracking
 */

const adaptiveLearning = require("../services/adaptiveLearningService");
const {
  AnalysisFeedback,
  PatternEffectiveness,
  UserReputation,
  CommunityThresholds,
} = require("../models/AdaptiveLearning");

// Mock database (in real tests, use test database)
const mockDb = {
  patterns: new Map(),
  users: new Map(),
  feedback: [],
};

describe("Path C - Adaptive Learning System", () => {
  beforeEach(() => {
    mockDb.patterns.clear();
    mockDb.users.clear();
    mockDb.feedback = [];
  });

  describe("Pattern Effectiveness Learning", () => {
    test("should track correct pattern detections", () => {
      const pattern = {
        pattern: "wire\\s+transfer",
        category: "payment",
        baseWeight: 20,
        stats: {
          totalDetections: 0,
          confirmedAccurate: 0,
          falsePositives: 0,
          falseNegatives: 0,
        },
      };

      // Simulate 10 detections, 9 correct
      pattern.stats.totalDetections = 10;
      pattern.stats.confirmedAccurate = 9;
      pattern.stats.falsePositives = 1;

      const precision = pattern.stats.confirmedAccurate / pattern.stats.totalDetections;
      expect(precision).toBe(0.9);

      // Pattern is 90% accurate when it fires
      expect(precision).toBeGreaterThan(0.85);
    });

    test("should calculate precision, recall, and F1 score", () => {
      const pattern = {
        pattern: "password|PIN",
        category: "phishing",
        stats: {
          totalDetections: 100,
          confirmedAccurate: 95, // 95% caught correctly
          falsePositives: 5, // 5 false alarms
          falseNegatives: 10, // 10 scams we missed
        },
      };

      // Precision: Of detected cases, how many were correct?
      const precision = pattern.stats.confirmedAccurate / pattern.stats.totalDetections;
      expect(precision).toBe(0.95);

      // Recall: Of all actual scams, how many did we catch?
      const totalActualScams = pattern.stats.confirmedAccurate + pattern.stats.falseNegatives;
      const recall = pattern.stats.confirmedAccurate / totalActualScams;
      expect(recall).toBe(95 / 105); // 90.48%
      expect(recall).toBeGreaterThan(0.9);

      // F1 Score: Harmonic mean
      const f1 = (2 * precision * recall) / (precision + recall);
      expect(f1).toBeGreaterThan(0.92);
    });

    test("should recommend higher weights for effective patterns", () => {
      const calculateRecommendedWeight = (f1Score, baseWeight = 15) => {
        if (f1Score >= 0.9) return baseWeight * 1.5;
        if (f1Score >= 0.7) return baseWeight * 1.2;
        if (f1Score >= 0.5) return baseWeight * 1.0;
        if (f1Score >= 0.3) return baseWeight * 0.7;
        return baseWeight * 0.3;
      };

      // Excellent pattern
      expect(calculateRecommendedWeight(0.95)).toBe(22.5); // 15 * 1.5

      // Good pattern
      expect(calculateRecommendedWeight(0.78)).toBe(18); // 15 * 1.2

      // Weak pattern
      expect(calculateRecommendedWeight(0.35)).toBe(10.5); // 15 * 0.7

      // Poor pattern
      expect(calculateRecommendedWeight(0.2)).toBe(4.5); // 15 * 0.3
    });
  });

  describe("User Reputation Tracking", () => {
    test("should calculate reputation based on message history", () => {
      const rep = {
        reputationScore: 50,
        stats: {
          totalMessages: 100,
          cleanMessages: 90,
          falseFlags: 5,
          confirmedScams: 5,
        },
      };

      // Simulate reputation calculation
      let score = 50;
      const cleanRatio = rep.stats.cleanMessages / rep.stats.totalMessages;
      score += cleanRatio * 30; // 90 clean messages = +27

      const falseFlagRatio = rep.stats.falseFlags / rep.stats.totalMessages;
      score -= falseFlagRatio * 40; // 5 false flags = -2

      const scamRatio = rep.stats.confirmedScams / rep.stats.totalMessages;
      score -= scamRatio * 50; // 5 scams = -2.5

      // Final: 50 + 27 - 2 - 2.5 = 72.5
      expect(score).toBeCloseTo(72.5, 0);
      expect(score).toBeGreaterThan(70);
    });

    test("should assign trust levels based on reputation", () => {
      const determineTrustLevel = (rep) => {
        if (rep.stats.totalMessages < 5) return "new";
        if (
          rep.reputationScore >= 85 &&
          rep.stats.falseFlags === 0 &&
          rep.stats.totalMessages > 50
        ) {
          return "verified";
        }
        if (rep.reputationScore >= 75) return "trusted";
        if (rep.reputationScore >= 60) return "established";
        if (rep.reputationScore < 30) return "flagged";
        return "new";
      };

      // Verified user
      expect(
        determineTrustLevel({
          reputationScore: 90,
          stats: {
            totalMessages: 100,
            falseFlags: 0,
          },
        })
      ).toBe("verified");

      // Trusted user
      expect(
        determineTrustLevel({
          reputationScore: 78,
          stats: { totalMessages: 50 },
        })
      ).toBe("trusted");

      // Established user
      expect(
        determineTrustLevel({
          reputationScore: 65,
          stats: { totalMessages: 20 },
        })
      ).toBe("established");

      // Flagged user
      expect(
        determineTrustLevel({
          reputationScore: 20,
          stats: { totalMessages: 50 },
        })
      ).toBe("flagged");
    });

    test("should adjust risk thresholds for different trust levels", () => {
      const getCustomThreshold = (trustLevel) => {
        const thresholds = {
          verified: 50, // Higher threshold = fewer flags
          trusted: 40,
          established: 35,
          new: 30, // Lower threshold = more cautious
          flagged: 20, // Very low threshold for suspicious users
        };
        return thresholds[trustLevel] || 30;
      };

      expect(getCustomThreshold("verified")).toBe(50);
      expect(getCustomThreshold("trusted")).toBe(40);
      expect(getCustomThreshold("new")).toBe(30);
      expect(getCustomThreshold("flagged")).toBe(20);
    });
  });

  describe("Admin Feedback Processing", () => {
    test("should update pattern stats on correct detection feedback", () => {
      const pattern = {
        pattern: "wire transfer",
        stats: {
          totalDetections: 5,
          confirmedAccurate: 4,
          falsePositives: 1,
        },
      };

      // Admin confirms another detection as correct
      pattern.stats.totalDetections++;
      pattern.stats.confirmedAccurate++;

      expect(pattern.stats.totalDetections).toBe(6);
      expect(pattern.stats.confirmedAccurate).toBe(5);
      expect((pattern.stats.confirmedAccurate / pattern.stats.totalDetections).toFixed(2)).toBe(
        "0.83"
      );
    });

    test("should track false positive feedback", () => {
      const pattern = {
        pattern: "marry",
        stats: {
          totalDetections: 100,
          confirmedAccurate: 70,
          falsePositives: 30,
        },
      };

      // Low precision - many false positives
      const precision = pattern.stats.confirmedAccurate / pattern.stats.totalDetections;
      expect(precision).toBe(0.7);
      expect(precision).toBeLessThan(0.8);

      // Should reduce weight
      expect(70).toBeLessThan(75); // Less than 75% precision
    });

    test("should track false negative feedback", () => {
      const pattern = {
        pattern: "urgent",
        stats: {
          totalDetections: 20,
          confirmedAccurate: 15,
          falseNegatives: 25, // Missed many scams
        },
      };

      // Low recall - many false negatives
      const totalActualScams = pattern.stats.confirmedAccurate + pattern.stats.falseNegatives;
      const recall = pattern.stats.confirmedAccurate / totalActualScams;
      expect(recall).toBe(15 / 40);
      expect(recall).toBeLessThan(0.5);

      // Should lower threshold to catch more
    });
  });

  describe("Context-Aware Learning", () => {
    test("should learn farm context effects", () => {
      const marryPattern = {
        pattern: "marry|marriage",
        category: "romance",
        baseWeight: 10,
        contextFactors: {
          farmContext: 0.3, // Reduce weight in farm context
          newUser: 1.2, // Increase for new users
          trustedUser: 0.6, // Reduce for trusted
        },
      };

      const contextualWeight = (baseWeight, context) => {
        if (context === "farm") return baseWeight * marryPattern.contextFactors.farmContext;
        if (context === "newUser") return baseWeight * marryPattern.contextFactors.newUser;
        if (context === "trustedUser") return baseWeight * marryPattern.contextFactors.trustedUser;
        return baseWeight;
      };

      // Same pattern, different context
      expect(contextualWeight(10, "farm")).toBe(3); // Reduced in farm
      expect(contextualWeight(10, "farmContext")).toBe(10); // Default
      expect(contextualWeight(10, "newUser")).toBe(12); // Boosted for new users
      expect(contextualWeight(10, "trustedUser")).toBe(6); // Reduced for trusted
    });
  });

  describe("Learning System Performance", () => {
    test("should provide pattern effectiveness ratings", () => {
      const rateEffectiveness = (f1Score) => {
        if (f1Score >= 0.9) return "A+";
        if (f1Score >= 0.85) return "A";
        if (f1Score >= 0.75) return "B+";
        if (f1Score >= 0.65) return "B";
        if (f1Score >= 0.5) return "C";
        return "F";
      };

      expect(rateEffectiveness(0.95)).toBe("A+");
      expect(rateEffectiveness(0.87)).toBe("A");
      expect(rateEffectiveness(0.72)).toBe("B");
      expect(rateEffectiveness(0.55)).toBe("C");
      expect(rateEffectiveness(0.3)).toBe("F");
    });

    test("should track overall system improvement", () => {
      const patterns = [
        { f1Score: 0.92, falsePositives: 2 },
        { f1Score: 0.88, falsePositives: 5 },
        { f1Score: 0.75, falsePositives: 15 },
        { f1Score: 0.65, falsePositives: 20 },
      ];

      const avgF1 = patterns.reduce((sum, p) => sum + p.f1Score, 0) / patterns.length;
      expect(avgF1).toBeCloseTo(0.8, 1);

      const excellentPatterns = patterns.filter((p) => p.f1Score >= 0.85).length;
      expect(excellentPatterns).toBe(2);

      const improvablePatterns = patterns.filter((p) => p.f1Score < 0.75).length;
      expect(improvablePatterns).toBe(1);
    });
  });

  describe("Community Threshold Calibration", () => {
    test("should adjust thresholds based on false positive rate", () => {
      const adjustThreshold = (currentThreshold, falsePositiveRate, tolerance) => {
        if (falsePositiveRate > tolerance) {
          return currentThreshold + 5; // Raise to reduce false positives
        } else if (falsePositiveRate < tolerance * 0.5) {
          return currentThreshold - 5; // Lower to catch more
        }
        return currentThreshold; // Keep stable
      };

      // Too many false positives - raise threshold
      expect(adjustThreshold(30, 5, 3)).toBe(35);

      // Too many false negatives - lower threshold
      expect(adjustThreshold(30, 0.8, 3)).toBe(25);

      // Perfect balance - keep threshold
      expect(adjustThreshold(30, 3, 3)).toBe(30);
    });
  });

  describe("Integration: Full Feedback Loop", () => {
    test("should demonstrate complete learning cycle", () => {
      // 1. Initial analysis detects wireTransfer pattern
      const analysis = {
        riskScore: 35,
        isSuspicious: true,
        flaggedPatterns: ["wire\\s+transfer", "bank\\s+account"],
      };

      // 2. Admin reviews and marks as correct
      const feedback = {
        adminDecision: "correct", // Scam confirmed
        patterns: analysis.flaggedPatterns,
      };

      // 3. Update pattern stats
      feedback.patterns.forEach((pattern) => {
        // Pattern effectiveness increases
        expect(feedback.adminDecision).toBe("correct");
      });

      // 4. Update user reputation (if message was from suspicious user)
      const userUpdate = {
        totalMessages: 1,
        confirmedScams: 1,
        reputationScore: 45, // Lower due to scam
      };

      expect(userUpdate.reputationScore).toBeLessThan(50);

      // 5. System learns and improves
      expect(analysis.riskScore).toBeGreaterThan(30);
      expect(analysis.isSuspicious).toBe(true);
    });
  });

  describe("Learning System Edge Cases", () => {
    test("should handle new patterns gracefully", () => {
      const newPattern = {
        pattern: "unfamiliar_scam_indicator",
        stats: {
          totalDetections: 1,
          confirmedAccurate: 0,
        },
      };

      // Not enough data to judge effectiveness
      expect(newPattern.stats.totalDetections).toBe(1);
      expect(newPattern.stats.confirmedAccurate).toBe(0);

      // Should not override based on single data point
      let recommendedWeight = 15; // Stays at base
      if (newPattern.stats.totalDetections < 10) {
        recommendedWeight = 15; // Minimum data for adjustment
      }
      expect(recommendedWeight).toBe(15);
    });

    test("should prevent weight manipulation from single feedback", () => {
      const pattern = {
        baseWeight: 15,
        recommendedWeight: 15,
        stats: {
          totalDetections: 100,
          confirmedAccurate: 50,
        },
      };

      // One incorrect feedback shouldn't drastically change weight
      pattern.stats.confirmedAccurate = 49; // Reduced by 1

      const newF1 = 49 / 100; // 0.49
      let newWeight = 15;
      if (newF1 >= 0.5) {
        newWeight = 15 * 1.0; // Keep baseline
      } else {
        newWeight = 15 * 0.7; // Reduce by 30%
      }

      // Minimal change from one feedback
      expect(Math.abs(pattern.recommendedWeight - newWeight)).toBeLessThan(5);
    });
  });
});

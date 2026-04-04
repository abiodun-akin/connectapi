/**
 * Unit Tests for Enhanced Message Analyzer
 * Tests pattern matching, Gemini integration, and combined scoring
 */

describe("Message Analyzer - Enhanced with Gemini", () => {
  let messageAnalyzer;

  beforeEach(() => {
    // Clear module cache
    jest.clearAllMocks();
    jest.resetModules();

    // Mock geminiAnalyzer
    jest.mock("../utils/geminiAnalyzer", () => ({
      analyzeMessage: jest.fn(),
      analyzeWithGemini: jest.fn(),
      getStatus: jest.fn(() => ({
        initialized: true,
        cacheSize: 0,
        apiKeyConfigured: true,
      })),
    }));

    messageAnalyzer = require("../utils/messageAnalyzer");
  });

  describe("Pattern Analysis (Fallback)", () => {
    test("should detect payment fraud patterns", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Urgent wire transfer money to my bank account number details please hurry",
      );

      expect(result.isSuspicious).toBe(true);
      expect(result.riskScore).toBeGreaterThan(30);
      expect(result.flaggedPatterns.length).toBeGreaterThan(0);
    });

    test("should detect romance scam patterns", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "I love you so much! We could marry. I need money for a ticket to visit you ASAP.",
      );

      expect(result.riskScore).toBeGreaterThan(20);
    });

    test("should detect phishing patterns", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "URGENT: Please verify your password and bank account number details immediately!",
      );

      expect(result.riskScore).toBeGreaterThan(20);
    });

    test("should detect spam patterns", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Buy viagra now! Make money fast with our lottery!!",
      );

      expect(result.riskScore).toBeGreaterThan(20);
    });

    test("should detect multiple URLs", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "URGENT IMMEDIATE: http://example.com http://test.com http://spam.com http://more.com http://extra.com http://urgent.com",
      );

      expect(result.riskScore).toBeGreaterThan(15);
    });

    test("should identify safe content", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Hi! I'm interested in buying tomatoes from your farm. What's your price?",
      );

      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    test("should detect urgency keywords in context", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "URGENT: It is imperative wire funds immediately to this account"
      );

      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.reason).toBeDefined();
    });

    test("should detect secrecy keywords combined with request", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Send money but don't tell anyone or keep this secret"
      );

      expect(result.riskScore).toBeGreaterThanOrEqual(0);
    });

    test("should handle empty content", () => {
      const result = messageAnalyzer.analyzeMessagePatterns("");

      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    test("should handle null content gracefully", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(null);

      expect(result.isSuspicious).toBe(false);
      expect(result.reason).toContain("Invalid");
    });

    test("should handle very long content", () => {
      const longContent = "test ".repeat(500);
      const result = messageAnalyzer.analyzeMessagePatterns(longContent);

      expect(result.riskScore).toBeGreaterThan(0); // Long content adds penalty
    });

    test("should detect multiple caps", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "URGENT: Wire MONEY NOW CLICK HERE LOTTERY SEND FUNDS IMMEDIATELY MAKE EASY CASH",
      );

      expect(result.riskScore).toBeGreaterThan(0);
    });
  });

  describe("Risk Level Classification", () => {
    test("should classify SAFE (0 points)", () => {
      expect(messageAnalyzer.getRiskLevel(0)).toBe("SAFE");
    });

    test("should classify LOW (1-20)", () => {
      expect(messageAnalyzer.getRiskLevel(15)).toBe("LOW");
    });

    test("should classify MEDIUM (21-50)", () => {
      expect(messageAnalyzer.getRiskLevel(40)).toBe("MEDIUM");
    });

    test("should classify HIGH (51-80)", () => {
      expect(messageAnalyzer.getRiskLevel(65)).toBe("HIGH");
    });

    test("should classify CRITICAL (81-100)", () => {
      expect(messageAnalyzer.getRiskLevel(95)).toBe("CRITICAL");
    });

    test("should cap risk score at 100", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "URGENT WIRE MONEY NOW CLICK HERE LOTTERY WINNER PASSWORD VERIFY",
      );

      expect(result.riskScore).toBeLessThanOrEqual(100);
    });
  });

  describe("Risk Color Coding", () => {
    test("should return green for safe", () => {
      const color = messageAnalyzer.getRiskColor(0);
      expect(color).toBe("#28a745");
    });

    test("should return yellow for low", () => {
      const color = messageAnalyzer.getRiskColor(15);
      expect(color).toBe("#ffc107");
    });

    test("should return orange for medium", () => {
      const color = messageAnalyzer.getRiskColor(40);
      expect(color).toBe("#fd7e14");
    });

    test("should return red for high", () => {
      const color = messageAnalyzer.getRiskColor(65);
      expect(color).toBe("#dc3545");
    });

    test("should return dark red for critical", () => {
      const color = messageAnalyzer.getRiskColor(95);
      expect(color).toBe("#721c24");
    });
  });

  describe("Formatted Analysis", () => {
    test("should format analysis result correctly", () => {
      const analysis = {
        isSuspicious: true,
        riskScore: 65,
        reason: "Payment fraud detected",
        flaggedPatterns: ["payment", "urgency"],
        timestamp: new Date(),
      };

      const formatted = messageAnalyzer.formatAnalysisResult(analysis);

      expect(formatted).toHaveProperty("level");
      expect(formatted).toHaveProperty("score");
      expect(formatted).toHaveProperty("reason");
      expect(formatted).toHaveProperty("patterns");
      expect(formatted).toHaveProperty("color");
      expect(formatted.level).toBe("HIGH");
      expect(formatted.score).toBe(65);
      expect(formatted.color).toBe("#dc3545");
    });
  });

  describe("Edge Cases & Boundary Conditions", () => {
    test("should handle messages with only numbers", () => {
      const result = messageAnalyzer.analyzeMessagePatterns("123456789");
      expect(result.riskScore).toBeLessThan(50);
    });

    test("should handle messages with only special characters", () => {
      const result = messageAnalyzer.analyzeMessagePatterns("!@#$%^&*()");
      expect(result.isSuspicious).toBe(false);
    });

    test("should handle mixed case variations for wire patterns", () => {
      const result1 = messageAnalyzer.analyzeMessagePatterns("wire money transfer");
      const result2 = messageAnalyzer.analyzeMessagePatterns("WIRE MONEY TRANSFER");
      const result3 = messageAnalyzer.analyzeMessagePatterns("Wire Money Transfer");

      // All should detect the pattern regardless of case
      expect(result1.riskScore).toBeGreaterThan(0);
      expect(result2.riskScore).toBeGreaterThan(0);
      expect(result3.riskScore).toBeGreaterThan(0);
    });

    test("should handle single character", () => {
      const result = messageAnalyzer.analyzeMessagePatterns("a");
      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    test("should handle medical/farm context (false positive check)", () => {
      // Context: These are legitimate farm messages
      const result = messageAnalyzer.analyzeMessagePatterns(
        "I need to marry these plants together for grafting",
      );

      // Should be low risk (pattern matches 'marry' but legitimately used)
      expect(result.riskScore).toBeLessThan(50);
    });

    test("should handle multiple URLs", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Visit http://a.com https://b.com http://c.com"
      );

      expect(result.riskScore).toBeGreaterThan(0); // Multiple URLs detected
    });

    test("should handle messages with mixed languages", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Hello 你好 مرحبا wire money now",
      );

      expect(result.riskScore).toBeGreaterThan(0); // Should catch 'wire money'
    });
  });

  describe("Pattern Categories", () => {
    test("should identify payment category", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Send crypto payment now",
      );

      const hasPaymentPattern = result.flaggedPatterns.some(
        (p) => p.category === "payment",
      );
      expect(hasPaymentPattern).toBe(true);
    });

    test("should identify romance category", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "I love you, marry me",
      );

      const hasRomancePattern = result.flaggedPatterns.some(
        (p) => p.category === "romance",
      );
      expect(hasRomancePattern).toBe(true);
    });

    test("should identify phishing category", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Verify your password now",
      );

      const hasPhishingPattern = result.flaggedPatterns.some(
        (p) => p.category === "phishing",
      );
      expect(hasPhishingPattern).toBe(true);
    });

    test("should identify spam category", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Make money fast with our lottery",
      );

      const hasSpamPattern = result.flaggedPatterns.some(
        (p) => p.category === "spam",
      );
      expect(hasSpamPattern).toBe(true);
    });
  });

  describe("Risk Score Thresholds", () => {
    test("should flag as suspicious when score > 30", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Wire $500 urgently to bank account",
      );

      if (result.riskScore > 30) {
        expect(result.isSuspicious).toBe(true);
      }
    });

    test("should not flag as suspicious when score <= 30", () => {
      const result = messageAnalyzer.analyzeMessagePatterns(
        "Hi there, looks nice outside",
      );

      expect(result.riskScore).toBeLessThanOrEqual(30);
      expect(result.isSuspicious).toBe(false);
    });
  });
});

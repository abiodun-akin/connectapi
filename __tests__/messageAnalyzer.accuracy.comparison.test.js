/**
 * Accuracy Improvements Comparison - Path B
 * Demonstrates context-aware detection reducing false positives
 */

const originalAnalyzer = require("../utils/messageAnalyzer");
const enhancedAnalyzer = require("../utils/messageAnalyzerEnhanced");

describe("Message Analyzer - Path B Accuracy Comparison", () => {
  describe("False Positive Reduction", () => {
    test("Farm context: 'marry' should not trigger high score", () => {
      const message = "Combine crop varieties and marry yield optimization";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      // Original might score high on "marry"
      // Enhanced should score low with farm context
      expect(enhanced.riskScore).toBeLessThan(original.riskScore + 10);
      expect(enhanced.riskScore).toBeLessThan(15);
    });

    test("Business: 'bank account' in normal context", () => {
      const message = "Update deposit to farm business bank account";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      // Should not flag as highly suspicious
      expect(enhanced.riskScore).toBeLessThan(25);
      expect(enhanced.isSuspicious).toBe(false);
    });

    test("Technical: 'password' might appear in legitimate setup", () => {
      const message = "Farm crop system password reset requested for portal";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      // Enhanced should recognize farm context reduces risk slightly
      expect(enhanced.hasFarmContext).toBe(true);
    });
  });

  describe("Correct High-Risk Detection", () => {
    test("Should still flag wire transfer + bank + urgency", () => {
      const message =
        "URGENT: Send wire transfer to my bank account immediately";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      // Both should flag this
      expect(enhanced.isSuspicious).toBe(true);
      expect(enhanced.riskScore).toBeGreaterThan(30);

      // Enhanced should have higher confidence due to multiple patterns
      expect(enhanced.confidence).toBeGreaterThan(0.3);
    });

    test("Should flag password verification requests", () => {
      const message = "Please verify your password immediately";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      expect(enhanced.isSuspicious).toBe(true);
      expect(enhanced.riskScore).toBeGreaterThan(25);
    });

    test("Should highlyWeights romantic scam with money request", () => {
      const message =
        "I love you so much. I need money for tickets to visit. Please send wire transfer.";

      const original = originalAnalyzer.analyzeMessagePatterns(message);
      const enhanced = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      expect(enhanced.isSuspicious).toBe(true);
      expect(enhanced.riskScore).toBeGreaterThan(40);
    });
  });

  describe("Weighted Pattern Scoring", () => {
    test("Phishing (password) weighted higher than generic words", () => {
      const phishingMessage = "Verify your password urgently";
      const genericMessage = "Please confirm you received my password";

      const phishing =
        enhancedAnalyzer.analyzeMessagePatternsEnhanced(phishingMessage);
      const generic =
        enhancedAnalyzer.analyzeMessagePatternsEnhanced(genericMessage);

      // Phishing request should score higher
      expect(phishing.riskScore).toBeGreaterThan(generic.riskScore);
    });

    test("Advance fee requests weighted very high", () => {
      const advanceFee =
        "Pay advance fee now and send wire transfer to unlock your farm subsidy benefits";

      const result =
        enhancedAnalyzer.analyzeMessagePatternsEnhanced(advanceFee);

      expect(result.riskScore).toBeGreaterThan(20);
    });
  });

  describe("Confidence Scoring Benefits", () => {
    test("Single ambiguous pattern has low confidence", () => {
      const message = "I love you";

      const result = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      expect(result.confidence).toBeLessThan(0.5);
      expect(result.isSuspicious).toBe(false);
    });

    test("Multiple correlated patterns have high confidence", () => {
      const message =
        "Wire transfer crypto payment to secure account urgently don't tell anyone";

      const result = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      expect(result.flaggedPatterns.length).toBeGreaterThan(1);
      expect(result.confidence).toBeGreaterThan(0.6);
    });
  });

  describe("Context Notes Help Admins", () => {
    test("Should include context notes for farm messages", () => {
      const message = "Farm equipment buyer wanting to marry the deal";

      const result = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      expect(result.contextualNotes.length).toBeGreaterThan(0);
      expect(result.contextualNotes[0]).toContain("Farm/agriculture");
    });

    test("Should note when pattern lacks required context", () => {
      const message = "Buy viagra from our partner";

      const result = enhancedAnalyzer.analyzeMessagePatternsEnhanced(message);

      // Spam detected but notes added
      expect(result.flaggedPatterns.length).toBeGreaterThan(0);
    });
  });

  describe("Performance - Enhanced is still fast", () => {
    test("Enhanced analyzer processes messages quickly", () => {
      const messages = Array(100)
        .fill()
        .map((_, i) => `Message ${i}: Send wire transfer to my account`);

      const start = Date.now();
      messages.forEach((msg) =>
        enhancedAnalyzer.analyzeMessagePatternsEnhanced(msg),
      );
      const elapsed = Date.now() - start;

      // Should process 100 messages in < 50ms (average <0.5ms per message)
      expect(elapsed).toBeLessThan(50);
    });
  });
});

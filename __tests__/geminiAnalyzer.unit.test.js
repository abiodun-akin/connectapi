/**
 * Unit Tests for Gemini Analyzer
 * Tests Gemini API integration, caching, fallback logic, and accuracy
 */

jest.mock("@google/generative-ai", () => {
  const mockGenerateContent = jest.fn();
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockReturnValue({
        generateContent: mockGenerateContent,
      }),
    })),
    mockGenerateContent,
  };
});

describe("Gemini Analyzer", () => {
  let geminiAnalyzer;
  let mockGenerateContent;

  beforeEach(() => {
    // Clear module cache to get fresh instance
    jest.clearAllMocks();
    jest.resetModules();

    // Set API key for tests
    process.env.GEMINI_API_KEY = "test-api-key";

    // Mock the API response
    const { mockGenerateContent: mocked } = require("@google/generative-ai");
    mockGenerateContent = mocked;

    // Import after mocking
    geminiAnalyzer = require("../utils/geminiAnalyzer");
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  describe("Gemini Initialization", () => {
    test("should initialize with valid API key", () => {
      const status = geminiAnalyzer.getStatus();
      expect(status.apiKeyConfigured).toBe(true);
    });

    test("should handle missing API key gracefully", () => {
      delete process.env.GEMINI_API_KEY;
      jest.resetModules();
      const analyzer = require("../utils/geminiAnalyzer");
      const status = analyzer.getStatus();
      expect(status.apiKeyConfigured).toBe(false);
    });
  });

  describe("Gemini Analysis", () => {
    test("should analyze suspicious payment message", async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: true,
              riskScore: 92,
              reason: "Payment fraud detected - wire transfer request",
              confidence: 0.98,
              detectedPatterns: ["payment_fraud"],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const content = "Wire me $5000 urgently for emergency!";
      const result = await geminiAnalyzer.analyzeWithGemini(content);

      expect(result).toBeDefined();
      expect(result.isSuspicious).toBe(true);
      expect(result.riskScore).toBe(92);
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.method).toBe("gemini");
    });

    test("should analyze safe content", async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: false,
              riskScore: 0,
              reason: "No suspicious patterns detected",
              confidence: 1.0,
              detectedPatterns: [],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const content = "Hi, I'm interested in buying tomatoes next week";
      const result = await geminiAnalyzer.analyzeWithGemini(content);

      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
      expect(result.confidence).toBe(1.0);
    });

    test("should handle romance scam detection", async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: true,
              riskScore: 88,
              reason:
                "Romance scam indicators - love confession + money request",
              confidence: 0.95,
              detectedPatterns: ["romance_scam", "urgency"],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const content = "I love you so much... I need money for a plane ticket";
      const result = await geminiAnalyzer.analyzeWithGemini(content);

      expect(result.isSuspicious).toBe(true);
      expect(result.riskScore).toBeGreaterThan(80);
      expect(result.detectedPatterns).toContain("romance_scam");
    });

    test("should handle phishing detection", async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: true,
              riskScore: 87,
              reason:
                "Phishing attempt - requesting password and account details",
              confidence: 0.97,
              detectedPatterns: ["phishing"],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const content =
        "Please verify your account by sending your password and account number";
      const result = await geminiAnalyzer.analyzeWithGemini(content);

      expect(result.isSuspicious).toBe(true);
      expect(result.detectedPatterns).toContain("phishing");
    });
  });

  describe("Caching", () => {
    test("should cache analysis results", async () => {
      const mockResponse = {
        response: {
          text: jest.fn(() =>
            JSON.stringify({
              isSuspicious: true,
              riskScore: 45,
              reason: "Suspicious",
              confidence: 0.8,
              detectedPatterns: [],
            }),
          ),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const content = "Test message";
      // First call - should hit API
      const result = await geminiAnalyzer.analyzeMessage(content, {
        isSuspicious: false,
        riskScore: 0,
        flaggedPatterns: [],
      });
      expect(result).not.toBeNull();
      expect(result.isSuspicious).toBe(true);

      // Second call - should hit cache
      const cached = geminiAnalyzer.getCachedAnalysis(content);
      expect(cached).toBeDefined();
      expect(cached.isSuspicious).toBe(true);
      expect(cached.fromCache).toEqual(undefined); // fromCache is added in analyzeMessage, not getCachedAnalysis

      // Verify API was only called once
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    test("should return null for cache miss", () => {
      const notCached = geminiAnalyzer.getCachedAnalysis(
        "Never analyzed before",
      );
      expect(notCached).toBeNull();
    });

    test("should clear cache", () => {
      geminiAnalyzer.clearCache();
      const status = geminiAnalyzer.getStatus();
      expect(status.cacheSize).toBe(0);
    });
  });

  describe("Error Handling", () => {
    test("should return null on API error", async () => {
      mockGenerateContent.mockRejectedValueOnce(
        new Error("API request failed"),
      );

      const result = await geminiAnalyzer.analyzeWithGemini("Test");
      expect(result).toBeNull();
    });

    test("should handle invalid JSON response", async () => {
      const mockResponse = {
        response: {
          text: () => "Not valid JSON {",
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const result = await geminiAnalyzer.analyzeWithGemini("Test");
      expect(result).toBeNull();
    });

    test("should handle malformed response structure", async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ missingFields: true }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const result = await geminiAnalyzer.analyzeWithGemini("Test");
      expect(result).toBeNull();
    });
  });

  describe("Combined Analysis with Fallback", () => {
    test("should use Gemini result when available", async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: true,
              riskScore: 75,
              reason: "Gemini detected",
              confidence: 0.9,
              detectedPatterns: [],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const patternAnalysis = {
        isSuspicious: false,
        riskScore: 10,
        reason: "Pattern analysis",
        flaggedPatterns: [],
      };

      const result = await geminiAnalyzer.analyzeMessage(
        "Test",
        patternAnalysis,
      );

      expect(result.method).toBe("gemini");
      expect(result.riskScore).toBe(75);
      expect(result.reason).toBe("Gemini detected");
    });

    test("should fallback to patterns on API error", async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error("API error"));

      const patternAnalysis = {
        isSuspicious: true,
        riskScore: 45,
        reason: "Pattern detected suspicious",
        flaggedPatterns: ["spam"],
      };

      const result = await geminiAnalyzer.analyzeMessage(
        "Test",
        patternAnalysis,
      );

      expect(result.method).toBe("pattern_matching");
      expect(result.riskScore).toBe(45);
      expect(result.reason).toBe("Pattern detected suspicious");
    });

    test("should return fallback when Gemini unavailable and no patterns", async () => {
      const result = await geminiAnalyzer.analyzeMessage("Test", null);

      expect(result.method).toBe("fallback");
      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
    });

    test("should handle invalid content", async () => {
      const result = await geminiAnalyzer.analyzeMessage("", null);

      expect(result.isSuspicious).toBe(false);
      expect(result.riskScore).toBe(0);
      expect(result.method).toBe("none");
    });
  });

  describe("Status Monitoring", () => {
    test("should report initialization status", () => {
      const status = geminiAnalyzer.getStatus();

      expect(status).toHaveProperty("initialized");
      expect(status).toHaveProperty("cacheSize");
      expect(status).toHaveProperty("apiKeyConfigured");
      expect(typeof status.initialized).toBe("boolean");
      expect(typeof status.cacheSize).toBe("number");
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long messages", async () => {
      const longMessage = "test ".repeat(500); // ~2500 chars

      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: false,
              riskScore: 5,
              reason: "Long but safe",
              confidence: 0.9,
              detectedPatterns: [],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const result = await geminiAnalyzer.analyzeWithGemini(longMessage);
      expect(result).toBeDefined();
      expect(result.riskScore).toBeLessThan(20);
    });

    test("should handle special characters", async () => {
      const specialMessage = "Alert: !@#$%^&*() 日本語 العربية";

      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              isSuspicious: false,
              riskScore: 0,
              reason: "Special chars handled",
              confidence: 0.95,
              detectedPatterns: [],
            }),
        },
      };

      mockGenerateContent.mockResolvedValueOnce(mockResponse);

      const result = await geminiAnalyzer.analyzeWithGemini(specialMessage);
      expect(result).toBeDefined();
    });

    test("should handle confidence boundary values", async () => {
      const testCases = [
        { confidence: 0, expected: 0 },
        { confidence: 0.5, expected: 0.5 },
        { confidence: 1, expected: 1 },
      ];

      for (const testCase of testCases) {
        const mockResponse = {
          response: {
            text: () =>
              JSON.stringify({
                isSuspicious: true,
                riskScore: 50,
                reason: "Test",
                confidence: testCase.confidence,
                detectedPatterns: [],
              }),
          },
        };

        mockGenerateContent.mockResolvedValueOnce(mockResponse);

        const result = await geminiAnalyzer.analyzeWithGemini("test");
        expect(result.confidence).toBe(testCase.expected);
      }
    });
  });
});

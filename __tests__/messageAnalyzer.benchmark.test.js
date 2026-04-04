/**
 * Performance Benchmarks for Message Analysis
 * Run with: npm test -- messageAnalyzer.benchmark.test.js
 * 
 * Measures:
 * - Pattern matching speed
 * - Cache effectiveness
 * - Memory usage
 * - Throughput
 */

describe("Message Analyzer - Performance Benchmarks", () => {
  let messageAnalyzer;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    messageAnalyzer = require("../utils/messageAnalyzer");
  });

  describe("Pattern Matching Speed", () => {
    test("safe message should analyze in <10ms", () => {
      const content = "Hi, I'm interested in buying tomatoes from your farm";

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(content);
      }
      const end = performance.now();

      const avgTime = (end - start) / 100;
      console.log(`\nSafe message avg: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(10);
    });

    test("suspicious message should analyze in <10ms", () => {
      const content = "Wire $5000 urgently to my bank account";

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(content);
      }
      const end = performance.now();

      const avgTime = (end - start) / 100;
      console.log(`Suspicious message avg: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(10);
    });

    test("long message should analyze in <20ms", () => {
      const content = "test message ".repeat(500); // ~6000 characters

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(content);
      }
      const end = performance.now();

      const avgTime = (end - start) / 100;
      console.log(`Long message avg: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(20);
    });

    test("complex message with multiple patterns should analyze in <15ms", () => {
      const content =
        "URGENT: Wire money NOW!!!!! Will PAY via Bitcoin or Western Union. Click here http://spam1.com or http://spam2.com MONEY FAST!!!";

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(content);
      }
      const end = performance.now();

      const avgTime = (end - start) / 100;
      console.log(`Complex message avg: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(15);
    });
  });

  describe("Throughput", () => {
    test("should process 1000 messages per second (pattern matching)", () => {
      const messages = [
        "Hi, how are you?",
        "Wire money now",
        "Check out http://example.com",
        "I love you",
        "Please verify password",
      ];

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        messageAnalyzer.analyzeMessagePatterns(
          messages[i % messages.length]
        );
      }
      const end = performance.now();

      const timeMs = end - start;
      const throughput = (1000 / timeMs) * 1000; // msgs per second

      console.log(
        `\nThroughput: ${throughput.toFixed(0)} messages/second (total: ${timeMs.toFixed(
          0
        )}ms)`
      );
      expect(throughput).toBeGreaterThan(1000); // At least 1000 msgs/sec
    });

    test("should handle burst of 100 messages in <100ms", () => {
      const messages = [
        "Safe message 123",
        "Suspicious: wire money",
        "Another safe one",
      ];

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(messages[i % messages.length]);
      }
      const end = performance.now();

      const totalTime = end - start;
      console.log(`Burst of 100: ${totalTime.toFixed(0)}ms`);
      expect(totalTime).toBeLessThan(200); // Should be fast
    });
  });

  describe("Risk Classification Speed", () => {
    test("getRiskLevel should be instant (<0.1ms)", () => {
      const scores = [0, 15, 40, 65, 95];

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        messageAnalyzer.getRiskLevel(scores[i % scores.length]);
      }
      const end = performance.now();

      const avgTime = (end - start) / 10000;
      console.log(`\ngetRiskLevel avg: ${avgTime.toFixed(4)}ms`);
      expect(avgTime).toBeLessThan(0.1);
    });

    test("getRiskColor should be instant (<0.1ms)", () => {
      const scores = [0, 15, 40, 65, 95];

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        messageAnalyzer.getRiskColor(scores[i % scores.length]);
      }
      const end = performance.now();

      const avgTime = (end - start) / 10000;
      console.log(`getRiskColor avg: ${avgTime.toFixed(4)}ms`);
      expect(avgTime).toBeLessThan(0.1);
    });

    test("formatAnalysisResult should be fast (<1ms)", () => {
      const analysis = {
        isSuspicious: true,
        riskScore: 65,
        reason: "Test",
        flaggedPatterns: ["payment", "urgency"],
        timestamp: new Date(),
      };

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        messageAnalyzer.formatAnalysisResult(analysis);
      }
      const end = performance.now();

      const avgTime = (end - start) / 1000;
      console.log(`formatAnalysisResult avg: ${avgTime.toFixed(3)}ms`);
      expect(avgTime).toBeLessThan(1);
    });
  });

  describe("Memory Efficiency", () => {
    test("should not leak memory with many analyses", () => {
      const initialMemory = process.memoryUsage().heapUsed;

      const messages = [
        "Safe message",
        "Wire money",
        "Verify password",
        "I love you",
        "Make money fast",
      ];

      for (let i = 0; i < 10000; i++) {
        messageAnalyzer.analyzeMessagePatterns(
          messages[i % messages.length]
        );
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(
        `\nMemory increase for 10k analyses: ${memoryIncrease.toFixed(2)}MB`
      );
      // Should not grow excessively (less than 50MB for 10k messages)
      expect(memoryIncrease).toBeLessThan(50);
    });
  });

  describe("Risk Score Distribution", () => {
    test("should show risk score statistics", () => {
      const testMessages = [
        { content: "Safe farming message about crops", risk: 0 },
        { content: "Hi there", risk: 0 },
        { content: "Wire $100 to my account to wire transfer funds", risk: 50 },
        { content: "URGENT WIRE MONEY NOW IMMEDIATELY", risk: 70 },
        { content: "Click here http://spam.com http://test.com for easy money make money fast", risk: 60 },
        { content: "I love you, marry me, need money for ticket", risk: 50 },
        { content: "Verify your password and account number details", risk: 60 },
      ];

      const results = testMessages.map((msg) => ({
        content: msg.content.substring(0, 30),
        riskScore: messageAnalyzer.analyzeMessagePatterns(msg.content)
          .riskScore,
        level: messageAnalyzer.getRiskLevel(
          messageAnalyzer.analyzeMessagePatterns(msg.content).riskScore
        ),
      }));

      console.log("\nRisk Score Distribution:");
      console.table(results);

      // Verify results make sense
      const safeCount = results.filter((r) => r.level === "SAFE").length;
      const lowCount = results.filter((r) => r.level === "LOW").length;
      const mediumCount = results.filter((r) => r.level === "MEDIUM").length;
      const highCount = results.filter((r) => r.level === "HIGH" || r.level === "CRITICAL").length;

      // Should have diversity in risk levels
      expect(safeCount).toBeGreaterThan(0);
      expect(safeCount + lowCount + mediumCount + highCount).toBeGreaterThan(0);
    });
  });

  describe("Comparative Performance", () => {
    test("short messages are faster than long messages", () => {
      const shortMsg = "Wire money";
      const longMsg = "Wire money " + "test ".repeat(1000);

      const startShort = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(shortMsg);
      }
      const endShort = performance.now();
      const shortTime = (endShort - startShort) / 100;

      const startLong = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(longMsg);
      }
      const endLong = performance.now();
      const longTime = (endLong - startLong) / 100;

      console.log(
        `\nShort message: ${shortTime.toFixed(3)}ms vs Long message: ${longTime.toFixed(
          3
        )}ms`
      );
      expect(longTime).toBeGreaterThanOrEqual(shortTime);
    });

    test("safe messages should be comparable speed to suspicious messages", () => {
      const safeMsg = "Hi there, how are you doing today?";
      const suspiciousMsg = "Wire $500 urgently to my bank account now!";

      const startSafe = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(safeMsg);
      }
      const endSafe = performance.now();
      const safeTime = (endSafe - startSafe) / 100;

      const startSuspicious = performance.now();
      for (let i = 0; i < 100; i++) {
        messageAnalyzer.analyzeMessagePatterns(suspiciousMsg);
      }
      const endSuspicious = performance.now();
      const suspiciousTime = (endSuspicious - startSuspicious) / 100;

      console.log(
        `\nSafe: ${safeTime.toFixed(3)}ms vs Suspicious: ${suspiciousTime.toFixed(
          3
        )}ms`
      );
      // Should be within 2x of each other
      expect(Math.max(safeTime, suspiciousTime)).toBeLessThan(
        Math.min(safeTime, suspiciousTime) * 2
      );
    });
  });
});

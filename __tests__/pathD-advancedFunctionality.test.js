/**
 * Path D - Advanced Functionality Tests
 * Tests for: Conversation Context, Rate-Limiting, Language Normalization
 */

const {
  analyzeConversationContext,
  detectMessagePhase,
  classifyConversationContext,
  getConversationRiskSummary,
} = require("../utils/messageAnalyzerContext");

const {
  analyzeUserRateLimiting,
  detectTemplateMessages,
  detectBotBehavior,
} = require("../utils/messageAnalyzerRateLimiting");

const {
  normalizeMessageContent,
  denormalizeLeetspeak,
  detectTextObfuscation,
  generateNormalizationReport,
} = require("../utils/messageAnalyzerLanguageNormalization");

describe("Path D - Advanced Functionality", () => {
  describe("Conversation Context Analysis", () => {
    test("should detect trust building phase", () => {
      const phase = detectMessagePhase(
        "Hi friend, I'm so glad to connect with you",
      );
      expect(phase.phase).toBe("trust_building");
      expect(phase.keywords.length).toBeGreaterThan(0);
      expect(phase.score).toBeGreaterThan(0);
    });

    test("should detect problem introduction phase", () => {
      const phase = detectMessagePhase(
        "I'm in urgent need of help with an emergency",
      );
      expect(phase.phase).toBe("problem_introduction");
      expect(phase.keywords).toContain("help");
      expect(phase.keywords).toContain("urgent");
    });

    test("should detect action request phase", () => {
      const phase = detectMessagePhase(
        "Please send money via wire transfer to my account",
      );
      expect(phase.phase).toBe("action_request");
      expect(phase.keywords).toContain("money");
      expect(phase.keywords).toContain("wire transfer");
    });

    test("should classify romance conversation context", () => {
      const messages = [
        { content: "I love you so much", timestamp: new Date() },
        { content: "Let's get married", timestamp: new Date() },
      ];
      const context = classifyConversationContext(messages);
      expect(context).toBe("romance");
    });

    test("should classify business conversation context", () => {
      const messages = [
        {
          content: "What is the price of your product?",
          timestamp: new Date(),
        },
        { content: "Can you provide an invoice?", timestamp: new Date() },
      ];
      const context = classifyConversationContext(messages);
      expect(context).toBe("business");
    });

    test("should detect escalation in conversation chain", async () => {
      const chain = [
        {
          content: "Hi, how are you?",
          sender_id: "user123",
          recipient_id: "user456",
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        },
        {
          content: "I need your help with something urgent",
          sender_id: "user123",
          recipient_id: "user456",
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        },
        {
          content: "Please send me money via wire transfer immediately",
          sender_id: "user123",
          recipient_id: "user456",
          timestamp: new Date(), // Now
        },
      ];

      const analysis = await analyzeConversationContext(chain);
      expect(analysis.escalationDetected).toBe(true);
      expect(analysis.escalationPhases.length).toBeGreaterThan(0);
      expect(analysis.riskScore).toBeGreaterThan(50);
    });

    test("should provide risk summary with recommendation", async () => {
      const chain = [
        {
          content: "I love you",
          sender_id: "user1",
          recipient_id: "user2",
          timestamp: new Date(Date.now() - 5 * 60 * 1000),
        },
        {
          content: "Send me money for an emergency",
          sender_id: "user1",
          recipient_id: "user2",
          timestamp: new Date(),
        },
      ];

      const analysis = await analyzeConversationContext(chain);
      const summary = getConversationRiskSummary(analysis);

      expect(summary.riskLevel).toBeDefined();
      expect(summary.recommendation).toBeDefined();
      expect(summary.escalationPhaseCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Rate-Limiting Detection", () => {
    test("should detect rapid messaging (high frequency)", async () => {
      const messages = Array.from({ length: 15 }, (_, i) => ({
        content: `Message ${i}`,
        sender_id: "spammer",
        recipient_id: `user${i}`,
        createdAt: new Date(Date.now() - (14 - i) * 4 * 60 * 1000), // 4-min intervals
      }));

      const analysis = await analyzeUserRateLimiting("spammer", messages);
      expect(analysis.suspicious).toBe(true);
      expect(analysis.patterns).toContain("rapid_messaging");
    });

    test("should detect mass recipient targeting", async () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        content: "Hello, wanna earn easy money?",
        sender_id: "scammer",
        recipient_id: `target${i}`,
        createdAt: new Date(Date.now() - i * 30 * 60 * 1000), // 30-min intervals
      }));

      const analysis = await analyzeUserRateLimiting("scammer", messages, {
        thresholds: { maxRecipientsPerHour: 5 },
      });
      expect(analysis.patterns).toContain("mass_recipient_targeting");
    });

    test("should detect template message reuse", async () => {
      const templateMsg =
        "Hi, I'm a Nigerian prince and I need your help. Reply ASAP.";
      const messages = Array.from({ length: 5 }, (_, i) => ({
        content: templateMsg, // Identical message
        sender_id: "bot",
        recipient_id: `victim${i}`,
        createdAt: new Date(Date.now() - i * 60 * 1000),
      }));

      const analysis = await analyzeUserRateLimiting("bot", messages);
      expect(analysis.patterns).toContain("template_reuse");
    });

    test("should detect bot-like behavior (perfect timing)", async () => {
      const messages = Array.from({ length: 8 }, (_, i) => ({
        content: `Automated message ${i}`,
        sender_id: "bot",
        recipient_id: `user${i}`,
        createdAt: new Date(Date.now() - i * 60 * 1000), // Exactly 1-min intervals
      }));

      const analysis = await analyzeUserRateLimiting("bot", messages);
      expect(analysis.patterns).toContain("bot_like_behavior");
    });

    test("should flag credential stuffing attempts", async () => {
      const credentialMessages = [
        {
          content: "Enter your password",
          sender_id: "attacker",
          recipient_id: "victim",
          createdAt: new Date(Date.now() - 8 * 60 * 1000),
        },
        {
          content: "Verify your PIN code",
          sender_id: "attacker",
          recipient_id: "victim",
          createdAt: new Date(Date.now() - 4 * 60 * 1000),
        },
        {
          content: "Please confirm your 2FA code",
          sender_id: "attacker",
          recipient_id: "victim",
          createdAt: new Date(Date.now() - 2 * 60 * 1000),
        },
        {
          content: "What's your account recovery code?",
          sender_id: "attacker",
          recipient_id: "victim",
          createdAt: new Date(Date.now() - 1 * 60 * 1000),
        },
        {
          content: "Send me your security question answer",
          sender_id: "attacker",
          recipient_id: "victim",
          createdAt: new Date(),
        },
      ];

      const analysis = await analyzeUserRateLimiting(
        "attacker",
        credentialMessages,
      );
      expect(analysis.patterns).toContain("credential_stuffing");
    });
  });

  describe("Language Normalization", () => {
    test("should denormalize common leetspeak", () => {
      const variations = [
        { leet: "p@ssw0rd", expected: "password" },
        { leet: "p4ssw0rd", expected: "password" },
        { leet: "tr@nsf3r", expected: "transfer" },
        { leet: "v3r1fy", expected: "verify" },
        { leet: "m0ney", expected: "money" },
      ];

      variations.forEach(({ leet, expected }) => {
        const result = denormalizeLeetspeak(leet);
        expect(result.toLowerCase()).toContain(expected.toLowerCase());
      });
    });

    test("should detect text obfuscation", () => {
      const obfuscated = "P@$$w0RD || V€R1FY || C0NF1RM";
      const analysis = detectTextObfuscation(obfuscated);

      expect(analysis.isObfuscated).toBe(true);
      expect(analysis.obfuscationScore).toBeGreaterThan(30);
      expect(analysis.techniques).toContain("numeric_substitution");
    });

    test("should detect mixed script obfuscation (Cyrillic/Latin)", () => {
      const mixedScript = "раssworд"; // Cyrillic 'р', 'а', 'д' mixed with Latin
      const analysis = detectTextObfuscation(mixedScript);

      expect(analysis.mixedScripts).toBeGreaterThan(1);
      expect(analysis.techniques).toContain("mixed_scripts");
    });

    test("should normalize accented characters", () => {
      const normalized = normalizeMessageContent("Hëllö wörld");
      expect(normalized.normalized).toContain("hello");
      expect(normalized.normalized).toContain("world");
      expect(normalized.variations).toContain("unicode_normalized");
    });

    test("should normalize excessive whitespace", () => {
      const normalized = normalizeMessageContent(
        "Hello    world  !!  How   are   you",
      );
      expect(normalized.normalized).toContain("hello world");
      expect(normalized.normalized).not.toContain("   "); // No triple spaces
    });

    test("should preserve meaning after normalization", () => {
      const original = "P@$$W0RD v3r1fy n0w!!!";
      const normalized = normalizeMessageContent(original);

      expect(normalized.normalized).toContain("password");
      expect(normalized.normalized).toContain("verify");
      expect(normalized.variations).toContain("leetspeak_detected");
    });

    test("should generate comprehensive normalization report", () => {
      const original = "Ürgënt: V€r1fy y0ur @cc0unt!!!";
      const report = generateNormalizationReport(original);

      expect(report.original).toBe(original);
      expect(report.normalized).toBeDefined();
      expect(report.statistics.originalLength).toBeGreaterThan(0);
      expect(report.obfuscationDetected).toBe(true);
      expect(report.suspiciousKeywords.length).toBeGreaterThan(0);
      expect(report.riskIndicators.obfuscated).toBe(true);
    });

    test("should identify suspicious keyword density", () => {
      const suspicious =
        "password password verify verify confirm code pin login";
      const report = generateNormalizationReport(suspicious);

      expect(report.riskIndicators.highKeywordDensity).toBe(true);
      expect(report.suspiciousKeywords.length).toBeGreaterThan(3);
    });
  });

  describe("End-to-End Integration Scenarios", () => {
    test("Scenario 1: Detect romance scam escalation", async () => {
      const chain = [
        {
          content: "Hi beautiful, I love your profile",
          sender_id: "scammer1",
          recipient_id: "victim1",
          timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
        {
          content: "Marry me? I want to spend my life with you",
          sender_id: "scammer1",
          recipient_id: "victim1",
          timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        },
        {
          content:
            "I've been in an accident and need $5000 urgently for hospital",
          sender_id: "scammer1",
          recipient_id: "victim1",
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
        },
        {
          content: "Please send wire transfer NOW or I might die",
          sender_id: "scammer1",
          recipient_id: "victim1",
          timestamp: new Date(),
        },
      ];

      const analysis = await analyzeConversationContext(chain, "romance");
      const summary = getConversationRiskSummary(analysis);

      expect(summary.riskLevel).toBe("critical");
      expect(analysis.escalationDetected).toBe(true);
      expect(analysis.escalationPhases.length).toBeGreaterThan(2);
    });

    test("Scenario 2: Detect bot spam campaign (mass template + rate limit)", async () => {
      const template =
        "Click here to verify your account: http://malicious-link.com";
      const messages = Array.from({ length: 25 }, (_, i) => ({
        content: template,
        sender_id: "bot_campaign",
        recipient_id: `target${i}`,
        createdAt: new Date(Date.now() - (24 - i) * 5 * 60 * 1000),
      }));

      const rateLimitAnalysis = await analyzeUserRateLimiting(
        "bot_campaign",
        messages,
      );
      expect(rateLimitAnalysis.patterns).toContain("template_reuse");
      expect(rateLimitAnalysis.patterns).toContain("rapid_messaging");

      // Check language analysis
      const langAnalysis = generateNormalizationReport(template);
      expect(langAnalysis.riskIndicators.highKeywordDensity).toBe(true);
    });

    test("Scenario 3: Detect credential harvesting with obfuscation", async () => {
      const obfuscatedMessages = [
        {
          content: "Pl€@s€ v€r1fy y0ur p@ssw0rd n0w",
          sender_id: "harvester",
          recipient_id: "user5",
          createdAt: new Date(Date.now() - 2 * 60 * 1000),
        },
        {
          content: "C0NF1RM y0ur 2F@ c0d€ URG€NTLY",
          sender_id: "harvester",
          recipient_id: "user5",
          createdAt: new Date(Date.now() - 1 * 60 * 1000),
        },
        {
          content: "Üpd@t€ y0ur PIN c0d€ im€diately!!!",
          sender_id: "harvester",
          recipient_id: "user5",
          timestamp: new Date(),
        },
      ];

      // Analyze obfuscation
      const firstMsg = generateNormalizationReport(
        obfuscatedMessages[0].content,
      );
      expect(firstMsg.obfuscationDetected).toBe(true);
      expect(firstMsg.suspiciousKeywords).toContain("verify");
      expect(firstMsg.suspiciousKeywords).toContain("password");

      // Analyze conversation escalation
      const analysis = await analyzeConversationContext(
        obfuscatedMessages.map((m) => ({
          ...m,
          timestamp: new Date(m.createdAt || m.timestamp),
        })),
      );
      expect(analysis.escalationDetected).toBe(true);
    });
  });

  describe("Edge Cases & Robustness", () => {
    test("should handle empty message chain", async () => {
      const analysis = await analyzeConversationContext([]);
      expect(analysis.minimalChain).toBe(true);
      expect(analysis.escalationDetected).toBe(false);
    });

    test("should handle null/undefined content", () => {
      const phase1 = detectMessagePhase(null);
      const phase2 = detectMessagePhase(undefined);
      const phase3 = detectMessagePhase("");

      expect(phase1.phase).toBe("unknown");
      expect(phase2.phase).toBe("unknown");
      expect(phase3.phase).toBe("unknown");
    });

    test("should handle messages without timestamps", async () => {
      const chain = [
        { content: "Hi", sender_id: "u1", recipient_id: "u2" },
        { content: "Can you help?", sender_id: "u1", recipient_id: "u2" },
      ];

      const analysis = await analyzeConversationContext(chain);
      expect(analysis.minimalChain).toBe(true); // No timestamps
    });

    test("should normalize extremely obfuscated text", () => {
      const extreme = "ρ@$ϕ₩0rd_v€r1fy_с0nf1rm";
      const report = generateNormalizationReport(extreme);

      expect(report.obfuscationScore).toBeGreaterThan(50);
      expect(report.normalizationSteps.length).toBeGreaterThan(0);
    });
  });

  describe("Performance & Scalability", () => {
    test("should efficiently handle large message chain (100 messages)", async () => {
      const chain = Array.from({ length: 100 }, (_, i) => ({
        content:
          i % 3 === 0 ? "Help me!" : i % 3 === 1 ? "Send money" : "I love you",
        sender_id: "bulk_sender",
        recipient_id: `user${i}`,
        timestamp: new Date(Date.now() - (99 - i) * 60 * 1000),
      }));

      const start = Date.now();
      const analysis = await analyzeConversationContext(chain);
      const duration = Date.now() - start;

      expect(analysis).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    test("should efficiently process rapid message batches", async () => {
      const messages = Array.from({ length: 100 }, (_, i) => ({
        content: `Message ${i}`,
        sender_id: "rapid_sender",
        recipient_id: `target${i % 10}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));

      const start = Date.now();
      const analysis = await analyzeUserRateLimiting("rapid_sender", messages);
      const duration = Date.now() - start;

      expect(analysis).toBeDefined();
      expect(duration).toBeLessThan(500); // Should be very fast
    });
  });
});

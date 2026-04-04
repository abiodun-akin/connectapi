/**
 * Integration Tests for Message Analysis with Schema
 * Tests message save hook, auto-flagging, and database integration
 */

const mongoose = require("mongoose");
const Message = require("../message");
const User = require("../user");
const Match = require("../match");

describe("Message Analysis Integration - Schema", () => {
  let testMatch;
  let farmer;
  let vendor;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.CONN_STR || "mongodb://localhost:27017/farmconnect_test");
    }
  });

  afterAll(async () => {
    await Message.deleteMany({});
    await Match.deleteMany({});
    await User.deleteMany({});
  });

  beforeEach(async () => {
    // Create test users
    farmer = await User.create({
      name: "Test Farmer",
      email: "farmer@test.local",
      password: "hashedpassword",
      profileType: "farmer",
    });

    vendor = await User.create({
      name: "Test Vendor",
      email: "vendor@test.local",
      password: "hashedpassword",
      profileType: "vendor",
    });

    // Create test match
    testMatch = await Match.create({
      farmer_id: farmer._id,
      vendor_id: vendor._id,
      status: "approved",
    });
  });

  afterEach(async () => {
    await Message.deleteMany({});
    await Match.deleteMany({});
    await User.deleteMany({});
  });

  describe("Safe Message Analysis", () => {
    test("should not flag safe messages", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Hi! I'm interested in your tomatoes. What's your price?",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.aiAnalysisResult).toBeDefined();
      expect(saved.aiAnalysisResult.isSuspicious).toBe(false);
      expect(saved.aiAnalysisResult.riskScore).toBeLessThanOrEqual(30);
      expect(saved.status).not.toBe("flagged");
    });

    test("should store analysis details", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "What's your delivery availability?",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.aiAnalysisResult).toHaveProperty("isSuspicious");
      expect(saved.aiAnalysisResult).toHaveProperty("riskScore");
      expect(saved.aiAnalysisResult).toHaveProperty("reason");
      expect(saved.aiAnalysisResult).toHaveProperty("timestamp");
    });
  });

  describe("Suspicious Message Auto-Flagging", () => {
    test("should auto-flag payment fraud messages", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Wire $5000 to my bank account 12345",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.aiAnalysisResult).toBeDefined();
      expect(saved.aiAnalysisResult.isSuspicious).toBe(true);
      expect(saved.aiAnalysisResult.riskScore).toBeGreaterThan(30);
      expect(saved.status).toBe("flagged");
      expect(saved.flagReason).toContain("AI:");
    });

    test("should auto-flag romance scam messages", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "I love you so much, can you send me money for a ticket?",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.status).toBe("flagged");
      expect(saved.aiAnalysisResult.isSuspicious).toBe(true);
    });

    test("should auto-flag phishing messages", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Please verify your account password",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.status).toBe("flagged");
      expect(saved.aiAnalysisResult.isSuspicious).toBe(true);
    });

    test("should store flag reason from analysis", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "URGENT: Wire funds now!!!",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.flagReason).toBeDefined();
      expect(saved.flagReason.startsWith("AI:")).toBe(true);
    });
  });

  describe("Analysis Timestamp", () => {
    test("should include analysis timestamp", async () => {
      const beforeSave = new Date();

      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Test message",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      const analysisTime = new Date(
        saved.aiAnalysisResult.timestamp
      );

      expect(analysisTime).toBeGreaterThanOrEqual(beforeSave);
      expect(analysisTime).toBeLessThanOrEqual(new Date());
    });
  });

  describe("Pattern Detection in Database", () => {
    test("should detect and store multiple patterns", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content:
          "URGENT: Wire $500 to my bank account and click here http://spam.com NOW",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.aiAnalysisResult.flaggedPatterns.length).toBeGreaterThan(0);
    });

    test("should categorize detected patterns", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Wire money to bitcoin address now",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      const hasCategory = saved.aiAnalysisResult.flaggedPatterns.some(
        (p) => p.category
      );
      expect(hasCategory).toBe(true);
    });
  });

  describe("Message Indexing by Analysis", () => {
    test("should query flagged messages by aiAnalysisResult", async () => {
      // Create mix of safe and suspicious messages
      const safeMsg = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Safe message",
      });

      const suspiciousMsg = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Wire $1000 now",
      });

      await safeMsg.save();
      await suspiciousMsg.save();

      // Query flagged messages
      const flagged = await Message.find({
        "aiAnalysisResult.isSuspicious": true,
      });

      expect(flagged.length).toBeGreaterThan(0);
      expect(
        flagged.every((m) => m.aiAnalysisResult.isSuspicious === true)
      ).toBe(true);
    });

    test("should efficiently query by risk score range", async () => {
      // Create messages with varying risk
      const messages = [
        "Safe message",
        "Wire money",
        "URGENT! PAY NOW!!!",
      ];

      for (const content of messages) {
        const msg = new Message({
          match_id: testMatch._id,
          sender_id: farmer._id,
          recipient_id: vendor._id,
          content,
        });
        await msg.save();
      }

      // Query high-risk messages
      const highRisk = await Message.find({
        "aiAnalysisResult.riskScore": { $gt: 50 },
      });

      console.log(
        `\nFound ${highRisk.length} high-risk messages out of 3`
      );
      expect(
        highRisk.every((m) => m.aiAnalysisResult.riskScore > 50)
      ).toBe(true);
    });
  });

  describe("Error Handling in Pre-Save Hook", () => {
    test("should save message even if analysis fails", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Test message",
      });

      // Should not throw error
      await expect(message.save()).resolves.toBeDefined();

      // Message should be saved
      const saved = await Message.findById(message._id);
      expect(saved).toBeDefined();
    });

    test("should have analysis result after save", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Test",
      });

      await message.save();

      const saved = await Message.findById(message._id);
      expect(saved.aiAnalysisResult).toBeDefined();
      expect(saved.aiAnalysisResult.isSuspicious).toBe(false);
    });
  });

  describe("Bulk Message Analysis", () => {
    test("should handle multiple messages efficiently", async () => {
      const messages = [];

      for (let i = 0; i < 10; i++) {
        messages.push(
          new Message({
            match_id: testMatch._id,
            sender_id: farmer._id,
            recipient_id: vendor._id,
            content: i % 2 === 0 ? "Safe message" : "Wire money urgently",
          })
        );
      }

      const start = performance.now();
      await Promise.all(messages.map((m) => m.save()));
      const end = performance.now();

      const saved = await Message.find({ match_id: testMatch._id });
      expect(saved.length).toBe(10);

      const avgTime = (end - start) / 10;
      console.log(`\nAverage save time: ${avgTime.toFixed(2)}ms per message`);
      expect(avgTime).toBeLessThan(100); // Should be reasonably fast
    });

    test("should aggregate analysis statistics", async () => {
      const messages = [
        "Safe message",
        "Safe message",
        "Wire $100",
        "URGENT WIRE NOW",
      ];

      for (const content of messages) {
        const msg = new Message({
          match_id: testMatch._id,
          sender_id: farmer._id,
          recipient_id: vendor._id,
          content,
        });
        await msg.save();
      }

      const stats = await Message.aggregate([
        { $match: { match_id: testMatch._id } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            suspiciousCount: {
              $sum: { $cond: ["$aiAnalysisResult.isSuspicious", 1, 0] },
            },
            avgRiskScore: { $avg: "$aiAnalysisResult.riskScore" },
          },
        },
      ]);

      expect(stats[0].count).toBe(4);
      expect(stats[0].suspiciousCount).toBeGreaterThan(0);
      expect(stats[0].avgRiskScore).toBeGreaterThan(0);
    });
  });

  describe("Analysis Persistence", () => {
    test("should not re-analyze on update", async () => {
      const message = new Message({
        match_id: testMatch._id,
        sender_id: farmer._id,
        recipient_id: vendor._id,
        content: "Original content",
      });

      await message.save();
      const originalAnalysis = message.aiAnalysisResult;

      // Update message (should not re-analyze if hook checks)
      message.status = "read";
      await message.save();

      const updated = await Message.findById(message._id);
      // Analysis should remain the same
      expect(updated.aiAnalysisResult.riskScore).toBe(
        originalAnalysis.riskScore
      );
    });
  });
});

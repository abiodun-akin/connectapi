const express = require("express");
const request = require("supertest");

jest.mock("../match", () => ({
  findById: jest.fn(),
}));

jest.mock("../message", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  sendMessage: jest.fn(),
  getConversation: jest.fn(),
  updateMany: jest.fn(),
  flagMessage: jest.fn(),
}));

jest.mock("../user", () => ({
  findById: jest.fn(),
}));

jest.mock("../utils/activityScorer", () => ({
  recordFlaggedMessage: jest.fn(),
}));

const Match = require("../match");
const Message = require("../message");
const messagesRoutes = require("../routes/messages");
const errorHandler = require("../middleware/errorHandler");

describe("Message search route integration", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { _id: "507f1f77bcf86cd799439011" };
      next();
    });
    app.use("/api/messages", messagesRoutes);
    app.use(errorHandler);
  });

  it("returns 400 when search query is shorter than 2 characters", async () => {
    const response = await request(app).get(
      "/api/messages/507f191e810c19729de860ea/search?q=a"
    );

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 when user is not part of the match", async () => {
    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "507f1f77bcf86cd799439012" },
      vendor_id: { toString: () => "507f1f77bcf86cd799439013" },
    });

    const response = await request(app).get(
      "/api/messages/507f191e810c19729de860ea/search?q=maize"
    );

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("returns filtered messages for authorized participants", async () => {
    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "507f1f77bcf86cd799439011" },
      vendor_id: { toString: () => "507f1f77bcf86cd799439013" },
    });

    const messages = [
      {
        _id: "msg-2",
        sender_id: "507f1f77bcf86cd799439011",
        recipient_id: "507f1f77bcf86cd799439013",
        content: "maize price update",
        status: "sent",
        createdAt: "2026-03-20T10:00:00.000Z",
      },
    ];

    const queryChain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(messages),
    };

    Message.find.mockReturnValue(queryChain);
    Message.countDocuments.mockResolvedValue(1);

    const response = await request(app).get(
      "/api/messages/507f191e810c19729de860ea/search?q=maize"
    );

    expect(response.status).toBe(200);
    expect(Message.find).toHaveBeenCalledWith(
      expect.objectContaining({
        match_id: "507f191e810c19729de860ea",
        content: { $regex: "maize", $options: "i" },
      })
    );
    expect(response.body.query).toBe("maize");
    expect(response.body.messages).toHaveLength(1);
    expect(response.body.pagination.total).toBe(1);
  });
});

const express = require("express");
const request = require("supertest");

jest.mock("../match", () => ({
  findById: jest.fn(),
}));

jest.mock("../message", () => ({
  sendMessage: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
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

describe("Message attachment integration", () => {
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

    Match.findById.mockResolvedValue({
      farmer_id: { toString: () => "507f1f77bcf86cd799439011" },
      vendor_id: { toString: () => "507f1f77bcf86cd799439013" },
      status: "connected",
    });
  });

  it("accepts attachment-only messages", async () => {
    Message.sendMessage.mockResolvedValue({ _id: "msg-1" });

    const response = await request(app)
      .post("/api/messages/send")
      .send({
        match_id: "507f191e810c19729de860ea",
        content: "",
        attachment: {
          url: "blob://demo",
          name: "invoice.pdf",
          mimeType: "application/pdf",
          size: 1200,
        },
      });

    expect(response.status).toBe(201);
    expect(Message.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        attachment: expect.objectContaining({ name: "invoice.pdf" }),
      })
    );
  });

  it("rejects request without content and attachment", async () => {
    const response = await request(app)
      .post("/api/messages/send")
      .send({
        match_id: "507f191e810c19729de860ea",
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});

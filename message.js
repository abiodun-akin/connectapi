const mongoose = require("mongoose");
const { analyzeMessage } = require("./utils/messageAnalyzer");

const messageSchema = new mongoose.Schema(
  {
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipient_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    match_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["sent", "read", "flagged", "archived"],
      default: "sent",
    },
    flagReason: String, // If flagged by admin/AI
    aiAnalysisResult: {
      isSuspicious: Boolean,
      riskScore: Number, // 0-100
      reason: String,
      flaggedPatterns: [
        {
          category: String,
          pattern: String,
        },
      ],
      timestamp: Date,
    },
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ sender_id: 1, recipient_id: 1, createdAt: -1 });
messageSchema.index({ match_id: 1, createdAt: -1 });
messageSchema.index({ status: 1, createdAt: -1 });
messageSchema.index({ "aiAnalysisResult.isSuspicious": 1 });

// Pre-save hook: Analyze message content
messageSchema.pre("save", function (next) {
  if (!this.aiAnalysisResult) {
    const analysis = analyzeMessage(this.content);
    this.aiAnalysisResult = analysis;

    // Auto-flag if suspicious
    if (analysis.isSuspicious) {
      this.status = "flagged";
      this.flagReason = "AI: " + analysis.reason;
    }
  }
  next();
});

// Static methods
messageSchema.statics.sendMessage = async function (messageData) {
  const { sender_id, recipient_id, match_id, content } = messageData;
  
  return this.create({
    sender_id,
    recipient_id,
    match_id,
    content,
  });
};

messageSchema.statics.getConversation = async function (match_id, limit = 50, skip = 0) {
  return this.find({
    match_id,
  })
    .select("sender_id recipient_id content status createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .exec()
    .then((messages) => messages.reverse()); // Return in chronological order
};

messageSchema.statics.markAsRead = async function (recipient_id, match_id) {
  return this.updateMany(
    {
      recipient_id,
      match_id,
      status: "sent",
    },
    { status: "read" }
  );
};

messageSchema.statics.flagMessage = async function (messageId, userId, reason) {
  return this.findByIdAndUpdate(
    messageId,
    {
      status: "flagged",
      flagReason: reason || "User flagged",
    },
    { new: true }
  );
};

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;

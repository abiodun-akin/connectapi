const mongoose = require("mongoose");
const { analyzeMessage } = require("./utils/messageAnalyzer");

const ALLOWED_ATTACHMENT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;

const normalizeAttachment = (attachment) => {
  if (!attachment) return null;

  const url = String(attachment.url || "").trim();
  const name = String(attachment.name || "").trim();
  const mimeType = String(attachment.mimeType || "").trim().toLowerCase();
  const size = Number(attachment.size || 0);

  if (!url || !name || !mimeType || !Number.isFinite(size) || size <= 0) {
    throw new Error("Invalid attachment payload");
  }

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
    throw new Error("Unsupported attachment type");
  }

  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error("Attachment exceeds size limit");
  }

  return {
    url,
    name,
    mimeType,
    size,
  };
};

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
      default: "",
    },
    attachment: {
      url: String,
      name: String,
      mimeType: String,
      size: Number,
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
messageSchema.pre("save", async function (next) {
  if (!this.content && !this.attachment) {
    return next(new Error("Message must include content or attachment"));
  }

  if (!this.aiAnalysisResult) {
    try {
      const analysis = await analyzeMessage(this.content || "");
      this.aiAnalysisResult = analysis;

      // Auto-flag if suspicious
      if (analysis.isSuspicious) {
        this.status = "flagged";
        this.flagReason = "AI: " + analysis.reason;
      }
      next();
    } catch (error) {
      console.error("[Message Analysis] Error:", error.message);
      // Continue with patterns-only fallback
      const { analyzeMessagePatterns } = require("./utils/messageAnalyzer");
      const analysis = analyzeMessagePatterns(this.content || "");
      this.aiAnalysisResult = analysis;
      if (analysis.isSuspicious) {
        this.status = "flagged";
        this.flagReason = "AI: " + analysis.reason;
      }
      next();
    }
  } else {
    next();
  }
});

// Static methods
messageSchema.statics.sendMessage = async function (messageData) {
  const { sender_id, recipient_id, match_id, content, attachment } = messageData;
  const normalizedContent = String(content || "").trim();
  const normalizedAttachment = normalizeAttachment(attachment);
  
  return this.create({
    sender_id,
    recipient_id,
    match_id,
    content: normalizedContent,
    attachment: normalizedAttachment,
  });
};

messageSchema.statics.getConversation = async function (match_id, limit = 50, skip = 0) {
  return this.find({
    match_id,
  })
    .select("sender_id recipient_id content attachment status createdAt")
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

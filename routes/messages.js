const express = require("express");
const router = express.Router();
const Message = require("../message");
const Match = require("../match");
const User = require("../user");
const { recordFlaggedMessage } = require("../utils/activityScorer");
const { NotFoundError, ValidationError } = require("../errors/AppError");

/**
 * POST /api/messages/send
 * Send message (requires approved match)
 */
router.post("/send", async (req, res, next) => {
  const { match_id, content, attachment } = req.body;

  try {
    if (!match_id) {
      throw new ValidationError("match_id is required", "match_id");
    }

    const normalizedContent = String(content || "").trim();
    if (!normalizedContent && !attachment) {
      throw new ValidationError("content or attachment is required", "content");
    }

    if (normalizedContent.length > 5000) {
      throw new ValidationError(
        "Content must be between 1 and 5000 characters",
        "content",
      );
    }

    const match = await Match.findById(match_id);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user is part of this match
    if (
      match.farmer_id.toString() !== req.user._id.toString() &&
      match.vendor_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to send messages in this match",
        code: "UNAUTHORIZED",
      });
    }

    // Check if match is in appropriate status for messaging
    if (!["interested", "connected"].includes(match.status)) {
      return res.status(400).json({
        error: "Cannot send messages in this match status",
        code: "INVALID_MATCH_STATUS",
      });
    }

    // Determine recipient
    const recipient_id =
      match.farmer_id.toString() === req.user._id.toString()
        ? match.vendor_id
        : match.farmer_id;

    const message = await Message.sendMessage({
      sender_id: req.user._id,
      recipient_id,
      match_id,
      content: normalizedContent,
      attachment,
    });

    // Update match status to 'connected' if currently 'interested' (first message flow)
    if (match.status === "interested") {
      await Match.findByIdAndUpdate(
        match_id,
        { status: "connected" },
        { new: true },
      );
    }

    res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messages/conversations
 * Get all conversations for current user
 */
router.get("/conversations", async (req, res, next) => {
  const { limit = 20, page = 1 } = req.query;

  try {
    const skip = (page - 1) * limit;

    // Get unique matches where user is involved
    const matches = await Match.find({
      $or: [
        {
          farmer_id: req.user._id,
          status: { $in: ["interested", "connected"] },
        },
        {
          vendor_id: req.user._id,
          status: { $in: ["interested", "connected"] },
        },
      ],
    })
      .populate({
        path: "farmer_id vendor_id",
        select: "email",
      })
      .limit(parseInt(limit))
      .skip(skip);

    // Get latest message for each conversation
    const conversations = await Promise.all(
      matches.map(async (match) => {
        const latestMessage = await Message.findOne({
          match_id: match._id,
        })
          .sort({ createdAt: -1 })
          .limit(1);

        const otherUserId =
          match.farmer_id._id.toString() === req.user._id.toString()
            ? match.vendor_id._id
            : match.farmer_id._id;

        return {
          match_id: match._id,
          otherUser: otherUserId,
          otherUserEmail:
            match.farmer_id._id.toString() === req.user._id.toString()
              ? match.vendor_id.email
              : match.farmer_id.email,
          lastMessage: latestMessage?.content || null,
          lastMessageAt: latestMessage?.createdAt || null,
          status: match.status,
          matchScore: match.matchScore,
        };
      }),
    );

    const total = await Match.countDocuments({
      $or: [
        {
          farmer_id: req.user._id,
          status: { $in: ["interested", "connected"] },
        },
        {
          vendor_id: req.user._id,
          status: { $in: ["interested", "connected"] },
        },
      ],
    });

    res.json({
      conversations: conversations.sort(
        (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt),
      ),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messages/:matchId/search
 * Search messages in a conversation
 */
router.get("/:matchId/search", async (req, res, next) => {
  const { q = "", limit = 20, page = 1 } = req.query;

  try {
    const searchTerm = String(q || "").trim();
    if (searchTerm.length < 2) {
      throw new ValidationError(
        "Search query must be at least 2 characters",
        "q",
      );
    }

    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user is part of this match
    if (
      match.farmer_id.toString() !== req.user._id.toString() &&
      match.vendor_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to search this conversation",
        code: "UNAUTHORIZED",
      });
    }

    const parsedLimit = parseInt(limit, 10);
    const parsedPage = parseInt(page, 10);
    const skip = (parsedPage - 1) * parsedLimit;
    const searchFilter = {
      match_id: req.params.matchId,
      content: { $regex: searchTerm, $options: "i" },
    };

    const [messages, total] = await Promise.all([
      Message.find(searchFilter)
        .select("sender_id recipient_id content status createdAt")
        .sort({ createdAt: -1 })
        .limit(parsedLimit)
        .skip(skip)
        .exec(),
      Message.countDocuments(searchFilter),
    ]);

    res.json({
      query: searchTerm,
      messages: messages.reverse(),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messages/:matchId
 * Get messages in a conversation
 */
router.get("/:matchId", async (req, res, next) => {
  const { limit = 50, page = 1 } = req.query;

  try {
    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user is part of this match
    if (
      match.farmer_id.toString() !== req.user._id.toString() &&
      match.vendor_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to view this conversation",
        code: "UNAUTHORIZED",
      });
    }

    const skip = (page - 1) * limit;
    const messages = await Message.getConversation(
      req.params.matchId,
      limit,
      skip,
    );
    const total = await Message.countDocuments({
      match_id: req.params.matchId,
    });

    // Mark messages as read
    await Message.updateMany(
      {
        match_id: req.params.matchId,
        recipient_id: req.user._id,
        status: "sent",
      },
      {
        status: "read",
      },
    );

    res.json({
      messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/messages/:messageId/flag
 * Flag message for admin review
 */
router.put("/:messageId/flag", async (req, res, next) => {
  const { reason } = req.body;

  try {
    const message = await Message.flagMessage(
      req.params.messageId,
      req.user._id,
      reason,
    );

    if (!message) {
      return next(new NotFoundError("Message"));
    }

    res.json({
      message: "Message flagged successfully",
      data: message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messages/stats/unread
 * Get unread message count
 */
router.get("/stats/unread", async (req, res, next) => {
  try {
    const unreadCount = await Message.countDocuments({
      recipient_id: req.user._id,
      status: "sent",
    });

    res.json({
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
});

// ADMIN ROUTES

/**
 * GET /api/messages/admin/flagged
 * Get flagged messages (admin only)
 */
router.get("/admin/flagged", async (req, res, next) => {
  const { limit = 20, page = 1, status = "flagged" } = req.query;

  try {
    // Check if user is admin (you'll need to add isAdmin field to User model)
    const user = await User.findById(req.user._id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
        code: "FORBIDDEN",
      });
    }

    const skip = (page - 1) * limit;
    const messages = await Message.find({
      status,
    })
      .populate("sender_id", "email")
      .populate("recipient_id", "email")
      .populate("match_id");

    const total = await Message.countDocuments({ status });

    res.json({
      messages: messages.slice(skip, skip + parseInt(limit)).map((msg) => ({
        _id: msg._id,
        sender: msg.sender_id.email,
        recipient: msg.recipient_id.email,
        content: msg.content,
        flagReason: msg.flagReason,
        status: msg.status,
        aiAnalysisResult: msg.aiAnalysisResult,
        createdAt: msg.createdAt,
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/messages/:messageId/admin/approve
 * Approve or reject flagged message (admin only)
 */
router.put("/:messageId/admin/approve", async (req, res, next) => {
  const { action } = req.body; // 'approve' or 'reject'

  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
        code: "FORBIDDEN",
      });
    }

    const message = await Message.findById(req.params.messageId);

    if (!message) {
      return next(new NotFoundError("Message"));
    }

    if (action === "approve") {
      message.status = "read";
      message.flagReason = null;
    } else if (action === "reject") {
      message.status = "archived";

      // Record violation against sender for confirmed suspicious behavior
      await recordFlaggedMessage(message.sender_id);
    } else {
      throw new ValidationError(
        "Action must be 'approve' or 'reject'",
        "action",
      );
    }

    await message.save();

    res.json({
      message: `Message ${action}d successfully`,
      data: message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messages/admin/ai-analysis
 * Get AI analysis statistics (admin only)
 */
router.get("/admin/ai-analysis", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
        code: "FORBIDDEN",
      });
    }

    const suspiciousMessages = await Message.find({
      "aiAnalysisResult.isSuspicious": true,
    })
      .select("aiAnalysisResult sender_id recipient_id createdAt")
      .limit(50);

    const stats = {
      totalAnalyzed: await Message.countDocuments({
        "aiAnalysisResult.timestamp": { $exists: true },
      }),
      suspicious: await Message.countDocuments({
        "aiAnalysisResult.isSuspicious": true,
      }),
      avgRiskScore: await Message.aggregate([
        {
          $match: {
            "aiAnalysisResult.timestamp": { $exists: true },
          },
        },
        {
          $group: {
            _id: null,
            avgRisk: { $avg: "$aiAnalysisResult.riskScore" },
          },
        },
      ]),
      recentSuspicious: suspiciousMessages.map((msg) => ({
        id: msg._id,
        sender: msg.sender_id,
        recipient: msg.recipient_id,
        riskScore: msg.aiAnalysisResult?.riskScore || 0,
        reason: msg.aiAnalysisResult?.reason || "Unknown",
        createdAt: msg.createdAt,
      })),
    };

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

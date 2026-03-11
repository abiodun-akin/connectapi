const express = require("express");
const router = express.Router();
const User = require("../user");
const Message = require("../message");
const Subscription = require("../subscription");
const bcrypt = require("bcryptjs");
const validator = require("validator");
const {
  suspendUserAccount,
  unsuspendUserAccount,
  getActivityReport,
  recordPaymentViolation,
} = require("../utils/activityScorer");
const { NotFoundError, UnauthorizedError, ValidationError } = require("../errors/AppError");

// Middleware to verify admin access
const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        error: "Admin access required",
        code: "FORBIDDEN",
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

// Apply admin middleware to all routes
router.use(verifyAdmin);

/**
 * GET /api/admin/users
 * List all users with activity scores and violation info
 */
router.get("/users", async (req, res, next) => {
  const { limit = 20, page = 1, sortBy = "createdAt", search } = req.query;

  try {
    const skip = (page - 1) * limit;

    const query = {};
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .select("-password")
      .limit(parseInt(limit))
      .skip(skip)
      .sort({ [sortBy]: -1 });

    const total = await User.countDocuments(query);

    // Get activity reports for each user
    const usersWithScores = await Promise.all(
      users.map(async (user) => {
        const report = await getActivityReport(user._id);
        return {
          _id: user._id,
          email: user.email,
          name: user.name,
          isSuspended: user.isSuspended,
          suspensionReason: user.suspensionReason,
          violationCount: user.violationCount || 0,
          flaggedMessageCount: user.flaggedMessageCount || 0,
          activityScore: report?.totalScore || 0,
          riskLevel: report?.riskLevel || "UNKNOWN",
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
        };
      })
    );

    res.json({
      users: usersWithScores,
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
 * GET /api/admin/users/:userId/activity-report
 * Get detailed activity report for a user
 */
router.get("/users/:userId/activity-report", async (req, res, next) => {
  try {
    const report = await getActivityReport(req.params.userId);

    if (!report) {
      return next(new NotFoundError("User activity report"));
    }

    res.json(report);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/users/:userId
 * Get user details and violation history
 */
router.get("/users/:userId", async (req, res, next) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");

    if (!user) {
      return next(new NotFoundError("User"));
    }

    const report = await getActivityReport(user._id);
    const flaggedMessageCount = await Message.countDocuments({
      sender_id: user._id,
      status: "flagged",
    });

    res.json({
      user: user.toObject(),
      activityReport: report,
      flaggedMessageCount,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users/:userId/suspend
 * Suspend user account
 */
router.post("/users/:userId/suspend", async (req, res, next) => {
  const { reason } = req.body;

  try {
    if (!reason) {
      return res.status(400).json({
        error: "Suspension reason is required",
        code: "VALIDATION_ERROR",
      });
    }

    const user = await suspendUserAccount(req.params.userId, reason);

    if (!user) {
      return next(new NotFoundError("User"));
    }

    // Publish suspension event
    const { publishEvent } = require("../middleware/eventNotification");
    await publishEvent("user_events", "user.suspended", {
      userId: user._id,
      email: user.email,
      reason,
      timestamp: new Date(),
    });

    res.json({
      message: "User account suspended successfully",
      user: {
        _id: user._id,
        email: user.email,
        isSuspended: user.isSuspended,
        suspensionReason: user.suspensionReason,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/users/:userId/unsuspend
 * Unsuspend user account
 */
router.post("/users/:userId/unsuspend", async (req, res, next) => {
  try {
    const user = await unsuspendUserAccount(req.params.userId);

    if (!user) {
      return next(new NotFoundError("User"));
    }

    // Publish unsuspension event
    const { publishEvent } = require("../middleware/eventNotification");
    await publishEvent("user_events", "user.unsuspended", {
      userId: user._id,
      email: user.email,
      timestamp: new Date(),
    });

    res.json({
      message: "User account unsuspended successfully",
      user: {
        _id: user._id,
        email: user.email,
        isSuspended: user.isSuspended,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/violations
 * List violations (payment defaults, flagged messages, suspensions)
 */
router.get("/violations", async (req, res, next) => {
  const { type = "all", limit = 20, page = 1 } = req.query;

  try {
    const skip = (page - 1) * limit;

    // Get users with violations
    let users = [];
    let total = 0;

    const collectPaymentViolations = async () => {
      const violationUsers = await User.find({
        violationCount: { $gt: 0 },
      })
        .select("email violationCount flaggedMessageCount isSuspended")
        .limit(parseInt(limit))
        .skip(skip);

      return violationUsers.map((u) => ({
        _id: u._id,
        email: u.email,
        violationType: "payment",
        violationCount: u.violationCount || 0,
        flaggedMessages: u.flaggedMessageCount || 0,
        isSuspended: u.isSuspended,
      }));
    };

    const collectFlaggedMessageViolations = async () => {
      const flaggedUsers = await User.find({ flaggedMessageCount: { $gt: 0 } })
        .select("email flaggedMessageCount violationCount isSuspended")
        .limit(parseInt(limit))
        .skip(skip);

      return flaggedUsers.map((u) => ({
        _id: u._id,
        email: u.email,
        violationType: "flaggedMessages",
        flaggedMessageCount: u.flaggedMessageCount || 0,
        paymentViolations: u.violationCount || 0,
        isSuspended: u.isSuspended,
      }));
    };

    const collectSuspensions = async () => {
      const suspendedUsers = await User.find({ isSuspended: true })
        .select(
          "email suspensionReason suspensionDate violationCount flaggedMessageCount"
        )
        .limit(parseInt(limit))
        .skip(skip);

      return suspendedUsers.map((u) => ({
        _id: u._id,
        email: u.email,
        violationType: "suspension",
        suspensionReason: u.suspensionReason,
        suspensionDate: u.suspensionDate,
        violationCount: u.violationCount || 0,
        flaggedMessageCount: u.flaggedMessageCount || 0,
      }));
    };

    if (type === "all" || type === "payment") {
      users = users.concat(await collectPaymentViolations());
      total += await User.countDocuments({ violationCount: { $gt: 0 } });
    }

    if (type === "all" || type === "flagged_messages") {
      const flaggedResults = await collectFlaggedMessageViolations();
      if (type === "flagged_messages") {
        users = flaggedResults;
        total = await User.countDocuments({ flaggedMessageCount: { $gt: 0 } });
      } else {
        users = users.concat(flaggedResults);

  /**
   * POST /api/admin/users/:userId/reset-password
   * Admin directly resets a non-admin user's password
   */
  router.post("/users/:userId/reset-password", async (req, res, next) => {
    const { newPassword } = req.body;

    try {
      if (!newPassword) {
        return next(new ValidationError("New password is required", "newPassword"));
      }

      if (
        !validator.isStrongPassword(newPassword, {
          minLength: 8,
          minLowercase: 1,
          minUppercase: 1,
          minNumbers: 1,
          minSymbols: 0,
        })
      ) {
        return next(
          new ValidationError(
            "Password must be at least 8 characters with 1 uppercase letter and 1 number",
            "newPassword"
          )
        );
      }

      const user = await User.findById(req.params.userId).select("+password isAdmin");
      if (!user) {
        return next(new NotFoundError("User"));
      }

      if (user.isAdmin) {
        return res.status(403).json({
          error: "Admin account passwords cannot be reset via this endpoint",
          code: "FORBIDDEN",
        });
      }

      user.password = await bcrypt.hash(newPassword, 12);
      await user.save();

      res.json({ message: "Password reset successfully" });
    } catch (error) {
      next(error);
    }
  });
        total += await User.countDocuments({ flaggedMessageCount: { $gt: 0 } });
      }
    }

    if (type === "all" || type === "suspended") {
      const suspendedResults = await collectSuspensions();
      if (type === "suspended") {
        users = suspendedResults;
        total = await User.countDocuments({ isSuspended: true });
      } else {
        users = users.concat(suspendedResults);
        total += await User.countDocuments({ isSuspended: true });
      }
    }

    if (type === "all") {
      users = users.slice(skip, skip + parseInt(limit));
    }

    res.json({
      violations: users,
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
 * POST /api/admin/users/:userId/record-violation
 * Manually record a payment violation
 */
router.post("/users/:userId/record-violation", async (req, res, next) => {
  const { type = "default" } = req.body; // 'default' or 'cancellation'

  try {
    await recordPaymentViolation(req.params.userId, type);

    const user = await User.findById(req.params.userId);
    const report = await getActivityReport(req.params.userId);

    res.json({
      message: "Violation recorded",
      user: {
        _id: user._id,
        email: user.email,
        violationCount: user.violationCount,
        isSuspended: user.isSuspended,
      },
      activityScore: report?.totalScore || 0,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/dashboard
 * Admin dashboard overview
 */
router.get("/dashboard", async (req, res, next) => {
  try {
    const totalUsers = await User.countDocuments();
    const suspendedUsers = await User.countDocuments({ isSuspended: true });
    const usersWithViolations = await User.countDocuments({
      violationCount: { $gt: 0 },
    });
    const usersWithFlaggedMessages = await User.countDocuments({
      flaggedMessageCount: { $gt: 0 },
    });
    const flaggedMessages = await Message.countDocuments({
      status: "flagged",
    });
    const recentlyFlaggedMessages = await Message.countDocuments({
      status: "flagged",
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });

    res.json({
      overview: {
        totalUsers,
        suspendedUsers,
        usersWithViolations,
        usersWithFlaggedMessages,
      },
      messages: {
        totalFlagged: flaggedMessages,
        recentlyFlagged: recentlyFlaggedMessages,
      },
      risks: {
        highRiskUsers: usersWithViolations + suspendedUsers,
        weeklyFlaggedMessages: recentlyFlaggedMessages,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/messages/flagged
 * List flagged messages for review
 */
router.get("/messages/flagged", async (req, res, next) => {
  const { limit = 20, page = 1 } = req.query;

  try {
    const skip = (page - 1) * limit;
    const messages = await Message.find({ status: "flagged" })
      .populate("sender_id", "email")
      .populate("recipient_id", "email")
      .populate("match_id")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Message.countDocuments({ status: "flagged" });

    res.json({
      messages: messages.map((msg) => ({
        _id: msg._id,
        sender: msg.sender_id?.email,
        recipient: msg.recipient_id?.email,
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
 * GET /api/admin/subscriptions/cancelled
 * List cancelled subscriptions with reasons
 */
router.get("/subscriptions/cancelled", async (req, res, next) => {
  const { limit = 20, page = 1 } = req.query;

  try {
    const skip = (page - 1) * limit;
    const subscriptions = await Subscription.find({ status: "cancelled" })
      .populate("user_id", "email")
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip);

    const total = await Subscription.countDocuments({ status: "cancelled" });

    res.json({
      subscriptions: subscriptions.map((sub) => ({
        _id: sub._id,
        userId: sub.user_id?._id,
        email: sub.user_id?.email,
        plan: sub.plan,
        amount: sub.amount,
        cancellationReason: sub.cancellationReason,
        updatedAt: sub.updatedAt,
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

module.exports = router;

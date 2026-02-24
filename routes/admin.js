const express = require("express");
const router = express.Router();
const User = require("../user");
const Message = require("../message");
const {
  suspendUserAccount,
  unsuspendUserAccount,
  getActivityReport,
  recordPaymentViolation,
} = require("../utils/activityScorer");
const { NotFoundError, UnauthorizedError } = require("../errors/AppError");

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
  const { limit = 20, page = 1, sortBy = "createdAt" } = req.query;

  try {
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select("-password")
      .limit(parseInt(limit))
      .skip(skip)
      .sort({ [sortBy]: -1 });

    const total = await User.countDocuments();

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

    if (type === "all" || type === "payment") {
      const violationUsers = await User.find({
        violationCount: { $gt: 0 },
      })
        .select("email violation* flaggedMessageCount")
        .limit(parseInt(limit))
        .skip(skip);

      users = violationUsers.map((u) => ({
        _id: u._id,
        email: u.email,
        violationType: "payment",
        violationCount: u.violationCount || 0,
        flaggedMessages: u.flaggedMessageCount || 0,
        isSuspended: u.isSuspended,
      }));

      total = await User.countDocuments({ violationCount: { $gt: 0 } });
    }

    if (type === "all" || type === "flagged_messages") {
      const flaggedUsers = await User.find({ flaggedMessageCount: { $gt: 0 } })
        .select("email flaggedMessage* violeationCount")
        .limit(parseInt(limit))
        .skip(skip);

      if (type === "flagged_messages") {
        users = flaggedUsers.map((u) => ({
          _id: u._id,
          email: u.email,
          violationType: "flaggedMessages",
          flaggedMessageCount: u.flaggedMessageCount || 0,
          paymentViolations: u.violationCount || 0,
          isSuspended: u.isSuspended,
        }));

        total = await User.countDocuments({ flaggedMessageCount: { $gt: 0 } });
      }
    }

    if (type === "all" || type === "suspended") {
      const suspendedUsers = await User.find({ isSuspended: true })
        .select("email suspensionReason suspensionDate violation* flaggedMessage*")
        .limit(parseInt(limit))
        .skip(skip);

      if (type === "suspended") {
        users = suspendedUsers.map((u) => ({
          _id: u._id,
          email: u.email,
          violationType: "suspension",
          suspensionReason: u.suspensionReason,
          suspensionDate: u.suspensionDate,
          violationCount: u.violationCount || 0,
          flaggedMessageCount: u.flaggedMessageCount || 0,
        }));

        total = await User.countDocuments({ isSuspended: true });
      }
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

module.exports = router;

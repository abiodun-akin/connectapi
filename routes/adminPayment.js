const express = require("express");
const router = express.Router();
const PaymentRecord = require("../paymentRecord");
const Subscription = require("../subscription");
const { verifyPaystackPayment, getPaystackSecretKey } = require("../utils/paystackUtils");
const { NotFoundError, ValidationError } = require("../errors/AppError");
const axios = require("axios");
const { publishEvent } = require("../middleware/eventNotification");

// Middleware to verify admin access
const verifyAdmin = async (req, res, next) => {
  try {
    const User = require("../user");
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

router.use(verifyAdmin);

/**
 * GET /api/admin/payments
 * List all payments with filters and sorting
 */
router.get("/payments", async (req, res, next) => {
  const { 
    status = "all", 
    limit = 20, 
    page = 1, 
    sortBy = "createdAt",
    search 
  } = req.query;

  try {
    const skip = (page - 1) * limit;
    const query = {};

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { plan: { $regex: search, $options: "i" } },
      ];
    }

    const payments = await PaymentRecord.find(query)
      .sort({ [sortBy]: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate("user_id", "email name")
      .lean();

    const total = await PaymentRecord.countDocuments(query);

    res.json({
      payments: payments.map(p => ({
        _id: p._id,
        reference: p.reference,
        email: p.email,
        userName: p.user_id?.name || "Unknown",
        plan: p.plan,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        refundStatus: p.refundStatus,
        paymentMethod: p.paymentMethod,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        verifiedAt: p.verifiedAt,
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
 * GET /api/admin/payments/:paymentId
 * Get payment details with full information
 */
router.get("/payments/:paymentId", async (req, res, next) => {
  try {
    const payment = await PaymentRecord.findById(req.params.paymentId)
      .populate("user_id", "email name phone")
      .populate("subscription_id", "plan status endDate");

    if (!payment) {
      return next(new NotFoundError("Payment record"));
    }

    res.json({
      payment: {
        ...payment.toObject(),
        paystackResponse: payment.paystackResponse || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/payments/:paymentId/verify
 * Manually reverify a payment with Paystack
 */
router.post("/payments/:paymentId/verify", async (req, res, next) => {
  try {
    const payment = await PaymentRecord.findById(req.params.paymentId);

    if (!payment) {
      return next(new NotFoundError("Payment record"));
    }

    if (!payment.reference) {
      return res.status(400).json({
        error: "Payment reference not found",
        code: "INVALID_PAYMENT",
      });
    }

    try {
      // Verify with Paystack
      const paystackData = await verifyPaystackPayment(payment.reference);

      if (paystackData.status === "success") {
        await PaymentRecord.updatePaymentStatus(
          payment.reference,
          "verified",
          paystackData,
          paystackData
        );

        publishEvent("payment_events", "admin.payment.reverified", {
          paymentId: payment._id,
          reference: payment.reference,
          admin: req.user._id,
          timestamp: new Date(),
        });

        return res.json({
          message: "Payment verified successfully",
          status: "verified",
        });
      } else {
        throw new Error("Payment verification failed: status not success");
      }
    } catch (paystackError) {
      await PaymentRecord.recordVerificationError(
        payment.reference,
        paystackError
      );

      return res.status(400).json({
        error: "Payment verification failed",
        paystackError: paystackError.message,
        code: "VERIFICATION_FAILED",
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/payments/:paymentId/refund
 * Initiate a refund via Paystack
 */
router.post("/payments/:paymentId/refund", async (req, res, next) => {
  const { reason } = req.body;

  try {
    const payment = await PaymentRecord.findById(req.params.paymentId);

    if (!payment) {
      return next(new NotFoundError("Payment record"));
    }

    if (payment.status !== "success" && payment.status !== "verified") {
      return res.status(400).json({
        error: "Only successful payments can be refunded",
        code: "INVALID_PAYMENT_STATUS",
      });
    }

    if (payment.refundStatus === "completed") {
      return res.status(400).json({
        error: "Payment already refunded",
        code: "ALREADY_REFUNDED",
      });
    }

    if (!payment.paystackTransactionId) {
      return res.status(400).json({
        error: "Paystack transaction ID not found",
        code: "MISSING_TRANSACTION_ID",
      });
    }

    try {
      const secretKey = getPaystackSecretKey();
      if (!secretKey) {
        return res.status(500).json({
          error: "Paystack secret key is not configured",
          code: "PAYSTACK_CONFIG_ERROR",
        });
      }

      // Call Paystack refund API
      const refundResponse = await axios.post(
        "https://api.paystack.co/refund",
        {
          transaction: payment.paystackTransactionId,
          amount: Math.round(payment.amount * 100), // Paystack uses kobo
        },
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
        }
      );

      if (!refundResponse.data.status) {
        throw new Error("Refund failed at Paystack");
      }

      const refundData = refundResponse.data.data;

      // Update payment record
      const updatedPayment = await PaymentRecord.completeRefund(
        payment._id,
        refundData.reference
      );

      // If there's a subscription, mark as cancelled
      if (payment.subscription_id) {
        await Subscription.cancelSubscription(
          payment.subscription_id,
          `Refund processed: ${reason}`
        );
      }

      publishEvent("payment_events", "admin.payment.refunded", {
        paymentId: payment._id,
        reference: payment.reference,
        refundReference: refundData.reference,
        amount: payment.amount,
        admin: req.user._id,
        timestamp: new Date(),
      });

      res.json({
        message: "Refund initiated successfully",
        refund: {
          reference: refundData.reference,
          status: refundData.status,
          amount: payment.amount,
        },
      });
    } catch (paystackError) {
      console.error("Paystack refund error:", paystackError.message);
      return res.status(400).json({
        error: "Refund failed",
        paystackError: paystackError.response?.data?.message || paystackError.message,
        code: "REFUND_FAILED",
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/payments/:paymentId/dispute
 * Record a payment dispute
 */
router.post("/payments/:paymentId/dispute", async (req, res, next) => {
  const { reason, evidence } = req.body;

  try {
    if (!reason) {
      throw new ValidationError("Dispute reason is required", "reason");
    }

    const payment = await PaymentRecord.findByIdAndUpdate(
      req.params.paymentId,
      {
        disputeStatus: "pending",
        disputeReason: reason,
        disputeEvidence: evidence,
      },
      { new: true }
    );

    if (!payment) {
      return next(new NotFoundError("Payment record"));
    }

    publishEvent("payment_events", "admin.payment.disputed", {
      paymentId: payment._id,
      reference: payment.reference,
      reason,
      admin: req.user._id,
      timestamp: new Date(),
    });

    res.json({
      message: "Dispute recorded",
      payment: {
        _id: payment._id,
        reference: payment.reference,
        disputeStatus: payment.disputeStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/payments/stats/overview
 * Get payment statistics and analytics
 */
router.get("/stats/overview", async (req, res, next) => {
  try {
    const stats = await PaymentRecord.getPaymentStats();
    
    const totalRevenue = await PaymentRecord.aggregate([
      { $match: { status: "success" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const refundedAmount = await PaymentRecord.aggregate([
      { $match: { refundStatus: "completed" } },
      { $group: { _id: null, total: { $sum: "$refundAmount" } } },
    ]);

    const totalPayments = await PaymentRecord.countDocuments();
    const successfulPayments = await PaymentRecord.countDocuments({
      status: "success",
    });
    const pendingPayments = await PaymentRecord.countDocuments({
      status: "pending",
    });
    const failedPayments = await PaymentRecord.countDocuments({
      status: "failed",
    });

    // Get revenue by plan
    const revenueByPlan = await PaymentRecord.aggregate([
      { $match: { status: "success" } },
      {
        $group: {
          _id: "$plan",
          count: { $sum: 1 },
          revenue: { $sum: "$amount" },
        },
      },
    ]);

    res.json({
      overview: {
        totalPayments,
        successfulPayments,
        successRate: totalPayments > 0 
          ? ((successfulPayments / totalPayments) * 100).toFixed(2) 
          : 0,
        pendingPayments,
        failedPayments,
        totalRevenue: totalRevenue[0]?.total || 0,
        refundedAmount: refundedAmount[0]?.total || 0,
      },
      statsByStatus: stats,
      revenueByPlan,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/payments/stats/daily
 * Get daily payment statistics
 */
router.get("/stats/daily", async (req, res, next) => {
  const { days = 30 } = req.query;

  try {
    const dailyStats = await PaymentRecord.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
          revenue: { $sum: "$amount" },
          successful: {
            $sum: {
              $cond: [{ $eq: ["$status", "success"] }, 1, 0],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ["$status", "failed"] }, 1, 0],
            },
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    res.json({
      dailyStats,
      period: `Last ${days} days`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/payments/pending
 * Get pending payments for follow-up
 */
router.get("/pending", async (req, res, next) => {
  const { limit = 20, page = 1 } = req.query;

  try {
    const skip = (page - 1) * limit;
    
    const payments = await PaymentRecord.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .populate("user_id", "email name")
      .lean();

    const total = await PaymentRecord.countDocuments({ status: "pending" });

    res.json({
      payments: payments.map(p => ({
        _id: p._id,
        reference: p.reference,
        email: p.email,
        userName: p.user_id?.name,
        plan: p.plan,
        amount: p.amount,
        createdAt: p.createdAt,
        hoursOld: Math.floor((Date.now() - new Date(p.createdAt)) / (1000 * 60 * 60)),
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

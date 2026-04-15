const express = require("express");
const router = express.Router();
const { publishEvent } = require("../middleware/eventNotification");
const {
  emailVerificationRequired,
} = require("../middleware/emailVerificationRequired");
const {
  validateRequest,
  validationRules,
} = require("../validators/inputValidator");
const {
  ValidationError,
  NotFoundError,
  InternalServerError,
} = require("../errors/AppError");
const PaymentRecord = require("../paymentRecord");
const Subscription = require("../subscription");
const { recordPaymentViolation } = require("../utils/activityScorer");
const {
  verifyPaystackPayment,
  validatePaystackResponse,
  getSubscriptionEndDate,
} = require("../utils/paystackUtils");

// Custom validation schema for payment initialization
const initializePaymentSchema = {
  plan: validationRules.plan,
  amount: validationRules.amount,
  email: validationRules.email,
};

// Verification schema
const verifyPaymentSchema = {
  reference: validationRules.reference,
  plan: validationRules.plan,
};

// Success schema
const successPaymentSchema = {
  reference: validationRules.reference,
  plan: validationRules.plan,
};

const SINGLE_PAID_PLAN = "premium";

/**
 * POST /api/payment/initialize
 * Create a payment record and initialize payment
 * Requires email verification
 */
router.post(
  "/initialize",
  emailVerificationRequired,
  validateRequest(initializePaymentSchema),
  async (req, res, next) => {
    const { plan, amount, email } = req.body;
    if (String(plan || "").toLowerCase() !== SINGLE_PAID_PLAN) {
      throw new ValidationError(
        `Only the ${SINGLE_PAID_PLAN} plan is currently supported`,
        "plan",
      );
    }

    try {
      const activeSubscription = await Subscription.getUserActiveSubscription(
        req.user._id,
      );
      if (activeSubscription?.hasUsedActiveTopup) {
        throw new ValidationError(
          "Only one extra payment is allowed while your current subscription is active",
          "subscription",
        );
      }

      // If the user is in an active trial and hasn't yet authorized their card,
      // only charge ₦50 for card authorization — the full amount is deferred.
      const isTrialAuth =
        activeSubscription?.status === "trial" &&
        !activeSubscription?.isCardAuthorized;
      const effectiveAmount = isTrialAuth ? 50 : amount;
      const recordType = isTrialAuth ? "trial_auth" : "payment";

      const reference = `ref_${req.user._id}_${Date.now()}`;

      // Create payment record
      const _paymentRecord = await PaymentRecord.createPaymentRecord({
        user_id: req.user._id,
        reference,
        plan: SINGLE_PAID_PLAN,
        amount: effectiveAmount,
        email,
        type: recordType,
      });

      publishEvent("payment_events", "payment.initialized", {
        userId: req.user._id,
        reference,
        plan: SINGLE_PAID_PLAN,
        amount: effectiveAmount,
        email,
        isTrialAuth,
        timestamp: new Date(),
      });

      res.json({
        message: isTrialAuth
          ? "Card authorization initialized — no charge today, ₦5,000 billed after trial"
          : "Payment initialized",
        reference,
        isTrialAuth,
        paymentData: {
          reference,
          plan: SINGLE_PAID_PLAN,
          amount: effectiveAmount,
          email,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/payment/verify
 * Verify payment with Paystack and update payment status
 * Requires email verification
 */
router.post(
  "/verify",
  emailVerificationRequired,
  validateRequest(verifyPaymentSchema),
  async (req, res, next) => {
    const { reference, plan } = req.body;

    try {
      if (String(plan || "").toLowerCase() !== SINGLE_PAID_PLAN) {
        throw new ValidationError(
          `Only the ${SINGLE_PAID_PLAN} plan is currently supported`,
          "plan",
        );
      }

      if (!reference || typeof reference !== "string") {
        throw new ValidationError("Reference is required", "reference");
      }

      // Get payment record
      const paymentRecord =
        await PaymentRecord.getPaymentByReference(reference);
      if (!paymentRecord) {
        throw new NotFoundError("Payment record");
      }

      // Verify with Paystack API
      let paystackData;
      try {
        paystackData = await verifyPaystackPayment(reference);
      } catch (paystackError) {
        console.error("Paystack verification failed:", paystackError.message);
        await PaymentRecord.recordVerificationError(reference, paystackError);

        // In non-production environments, allow local flow testing without external dependency.
        if (process.env.NODE_ENV === "production") {
          throw new InternalServerError(
            paystackError.message || "Unable to verify payment with Paystack",
          );
        }
        paystackData = {
          status: "success",
          amount: paymentRecord.amount,
          reference,
        };
      }

      if (!validatePaystackResponse(paystackData)) {
        await PaymentRecord.updatePaymentStatus(
          reference,
          "failed",
          paystackData,
        );

        // Record payment violation
        await recordPaymentViolation(req.user._id, "default");

        throw new ValidationError("Payment verification failed", "reference");
      }

      // Update payment record
      await PaymentRecord.updatePaymentStatus(
        reference,
        "verified",
        paystackData,
      );

      // If this is a trial card authorization, store the authorization code on the subscription
      if (paymentRecord.type === "trial_auth") {
        const authCode = paystackData.authorization?.authorization_code;
        if (authCode) {
          await Subscription.saveAuthorizationCode(
            req.user._id,
            authCode,
            paymentRecord.email,
          );
        }
      }

      publishEvent("payment_events", "payment.verified", {
        userId: req.user._id,
        reference,
        plan: SINGLE_PAID_PLAN,
        amount: paymentRecord.amount,
        email: paymentRecord.email,
        timestamp: new Date(),
      });

      res.json({
        message: "Payment verified successfully",
        status: "success",
        reference,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/payment/success
 * Finalize payment and create/update subscription
 * Requires email verification
 */
router.post(
  "/success",
  emailVerificationRequired,
  validateRequest(successPaymentSchema),
  async (req, res, next) => {
    const { reference, plan } = req.body;

    try {
      if (String(plan || "").toLowerCase() !== SINGLE_PAID_PLAN) {
        throw new ValidationError(
          `Only the ${SINGLE_PAID_PLAN} plan is currently supported`,
          "plan",
        );
      }

      if (!reference || typeof reference !== "string") {
        throw new ValidationError("Reference is required", "reference");
      }

      // Get payment record
      const paymentRecord =
        await PaymentRecord.getPaymentByReference(reference);
      if (!paymentRecord) {
        throw new NotFoundError("Payment record");
      }

      if (paymentRecord.status !== "verified") {
        throw new ValidationError(
          "Payment must be verified before confirming success",
          "reference",
        );
      }

      // For trial card authorizations, the card is already saved in verify step.
      // Just mark the payment record as success — no subscription is created yet.
      if (paymentRecord.type === "trial_auth") {
        paymentRecord.status = "success";
        await paymentRecord.save();
        return res.json({
          message:
            "Card authorized for future billing. You will be charged ₦5,000 when your free trial expires.",
          isCardAuthorization: true,
        });
      }

      // Calculate subscription end date
      const endDate = getSubscriptionEndDate(plan);

      // Create or update subscription
      let subscription;
      try {
        subscription = await Subscription.createOrUpdateSubscription(
          req.user._id,
          {
            plan: paymentRecord.plan,
            amount: paymentRecord.amount,
            startDate: new Date(),
            endDate,
            reference,
          },
        );
      } catch (subscriptionError) {
        if (subscriptionError.code === "ACTIVE_TOPUP_LIMIT_REACHED") {
          throw new ValidationError(subscriptionError.message, "subscription");
        }
        throw subscriptionError;
      }

      // Update payment record with subscription reference
      paymentRecord.subscription_id = subscription._id;
      paymentRecord.status = "success";
      await paymentRecord.save();

      publishEvent("payment_events", "payment.success", {
        userId: req.user._id,
        reference,
        plan: paymentRecord.plan,
        subscriptionId: subscription._id,
        email: paymentRecord.email,
        subscriptionEndDate: subscription.endDate,
        timestamp: new Date(),
      });

      res.json({
        message: "Payment success recorded",
        subscription: subscription,
        reference,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/payment/close
 * Cancel subscription
 * Requires email verification
 */
router.post("/close", emailVerificationRequired, async (req, res, next) => {
  try {
    // Cancel user's active subscription
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: { $in: ["active", "trial"] },
    });

    if (subscription) {
      await Subscription.cancelSubscription(
        req.user._id,
        "User-initiated cancellation",
      );

      // Record cancellation violation
      await recordPaymentViolation(req.user._id, "cancellation");
    }

    publishEvent("payment_events", "payment.closed", {
      userId: req.user._id,
      email: req.user.email,
      timestamp: new Date(),
    });

    res.json({ message: "Subscription cancelled successfully" });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/payment/cancel-renewal
 * Turn off auto-renewal while keeping current period active
 * Requires email verification
 */
router.post(
  "/cancel-renewal",
  emailVerificationRequired,
  async (req, res, next) => {
    try {
      const subscription = await Subscription.findOneAndUpdate(
        {
          user_id: req.user._id,
          status: { $in: ["active", "trial"] },
          endDate: { $gt: new Date() },
        },
        { autoRenewal: false },
        { new: true },
      );

      if (!subscription) {
        throw new NotFoundError("Active subscription");
      }

      publishEvent("payment_events", "payment.renewal.cancelled", {
        userId: req.user._id,
        subscriptionId: subscription._id,
        timestamp: new Date(),
      });

      res.json({
        message:
          "Auto-renewal cancelled. Your subscription remains active until end date.",
        subscription,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/payment/downgrade
 * Schedule a downgrade to free access at subscription renewal date.
 * Requires email verification
 */
router.post("/downgrade", emailVerificationRequired, async (req, res, next) => {
  try {
    const activeSubscription = await Subscription.getUserActiveSubscription(
      req.user._id,
    );

    if (!activeSubscription) {
      throw new NotFoundError("Active subscription");
    }

    if (activeSubscription.pendingDowngrade?.status === "scheduled") {
      throw new ValidationError(
        "A downgrade is already scheduled for this subscription",
        "subscription",
      );
    }

    const effectiveAt = activeSubscription.endDate;
    const downgradedSubscription = await Subscription.scheduleDowngrade(
      req.user._id,
      null,
      effectiveAt,
    );

    if (!downgradedSubscription) {
      throw new NotFoundError("Active subscription");
    }

    publishEvent("payment_events", "payment.downgrade.scheduled", {
      userId: req.user._id,
      fromPlan: activeSubscription.plan,
      toPlan: "free",
      effectiveAt,
      timestamp: new Date(),
    });

    res.json({
      message: "Downgrade to free access scheduled successfully",
      subscription: downgradedSubscription,
      accessChange: {
        from: activeSubscription.plan,
        to: "free",
        effectiveAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/payment/invoices
 * Fetch user invoice records.
 * NOTE: Read operation - accessible to all authenticated users (no email verification required)
 */
router.get("/invoices", async (req, res, next) => {
  try {
    const invoices = await PaymentRecord.getInvoicesByUser(req.user._id, 50);
    res.json({
      invoices: invoices.map((invoice) => ({
        reference: invoice.reference,
        plan: invoice.plan,
        amount: invoice.amount,
        status: invoice.status,
        createdAt: invoice.createdAt,
        description: invoice.description || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/payment/subscription
 * Get user's active subscription
 */
router.get("/subscription", async (req, res, next) => {
  try {
    const subscription = await Subscription.getUserActiveSubscription(
      req.user._id,
    );
    const hasEverSubscribed = await Subscription.hasEverSubscribed(
      req.user._id,
    );

    if (!subscription) {
      return res.json({
        hasActiveSubscription: false,
        hasEverSubscribed,
        subscription: null,
      });
    }

    res.json({
      hasActiveSubscription: true,
      hasEverSubscribed,
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        renewalDate: subscription.renewalDate,
        autoRenewal: subscription.autoRenewal,
        hasUsedActiveTopup: subscription.hasUsedActiveTopup,
        canMakeExtraPayment: !subscription.hasUsedActiveTopup,
        daysRemaining: Math.ceil(
          (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24),
        ),
        isTrialPeriod: subscription.isTrialPeriod,
        isCardAuthorized: subscription.isCardAuthorized,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

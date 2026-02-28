const express = require("express");
const router = express.Router();
const { publishEvent } = require("../middleware/eventNotification");
const { validateRequest, validationRules } = require("../validators/inputValidator");
const { ValidationError, NotFoundError } = require("../errors/AppError");
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

/**
 * POST /api/payment/initialize
 * Create a payment record and initialize payment
 */
router.post(
  "/initialize",
  validateRequest(initializePaymentSchema),
  async (req, res, next) => {
    const { plan, amount, email } = req.body;

    try {
      const reference = `ref_${req.user._id}_${Date.now()}`;

      // Create payment record
      const paymentRecord = await PaymentRecord.createPaymentRecord({
        user_id: req.user._id,
        reference,
        plan,
        amount,
        email,
      });

      publishEvent("payment_events", "payment.initialized", {
        userId: req.user._id,
        reference,
        plan,
        amount,
        email,
        timestamp: new Date(),
      });

      res.json({
        message: "Payment initialized",
        reference,
        paymentData: {
          reference,
          plan,
          amount,
          email,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/payment/verify
 * Verify payment with Paystack and update payment status
 */
router.post(
  "/verify",
  validateRequest(verifyPaymentSchema),
  async (req, res, next) => {
    const { reference, plan } = req.body;

    try {
      if (!reference || typeof reference !== "string") {
        throw new ValidationError("Reference is required", "reference");
      }

      // Get payment record
      const paymentRecord = await PaymentRecord.getPaymentByReference(reference);
      if (!paymentRecord) {
        throw new NotFoundError("Payment record");
      }

      // Verify with Paystack API
      let paystackData;
      try {
        paystackData = await verifyPaystackPayment(reference);
      } catch (paystackError) {
        console.error("Paystack verification failed:", paystackError.message);
        // For development, allow verification to proceed
        // In production, you would return an error here
        if (process.env.NODE_ENV === "production") {
          throw paystackError;
        }
        paystackData = { status: "success", amount: paymentRecord.amount };
      }

      if (!validatePaystackResponse(paystackData)) {
        await PaymentRecord.updatePaymentStatus(reference, "failed", paystackData);
        
        // Record payment violation
        await recordPaymentViolation(req.user._id, "default");
        
        throw new ValidationError("Payment verification failed", "reference");
      }

      // Update payment record
      await PaymentRecord.updatePaymentStatus(reference, "verified", paystackData);

      publishEvent("payment_events", "payment.verified", {
        userId: req.user._id,
        reference,
        plan,
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
  }
);

/**
 * POST /api/payment/success
 * Finalize payment and create/update subscription
 */
router.post(
  "/success",
  validateRequest(successPaymentSchema),
  async (req, res, next) => {
    const { reference, plan } = req.body;

    try {
      if (!reference || typeof reference !== "string") {
        throw new ValidationError("Reference is required", "reference");
      }

      // Get payment record
      const paymentRecord = await PaymentRecord.getPaymentByReference(reference);
      if (!paymentRecord) {
        throw new NotFoundError("Payment record");
      }

      if (paymentRecord.status !== "verified") {
        throw new ValidationError(
          "Payment must be verified before confirming success",
          "reference"
        );
      }

      // Calculate subscription end date
      const endDate = getSubscriptionEndDate(plan);

      // Create or update subscription
      const subscription = await Subscription.createOrUpdateSubscription(
        req.user._id,
        {
          plan: paymentRecord.plan,
          amount: paymentRecord.amount,
          startDate: new Date(),
          endDate,
          reference,
        }
      );

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
        subscriptionEndDate: endDate,
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
  }
);

/**
 * POST /api/payment/close
 * Cancel subscription
 */
router.post("/close", async (req, res, next) => {
  try {
    // Cancel user's active subscription
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: { $in: ["active", "trial"] },
    });

    if (subscription) {
      await Subscription.cancelSubscription(
        subscription._id,
        "User-initiated cancellation"
      );

      // Record cancellation violation
      await recordPaymentViolation(req.user._id, "cancellation");
    }

    publishEvent("payment_events", "payment.closed", {
      userId: req.user._id,
      timestamp: new Date(),
    });

    res.json({ message: "Subscription cancelled successfully" });
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
      req.user._id
    );

    if (!subscription) {
      return res.json({
        hasActiveSubscription: false,
        subscription: null,
      });
    }

    res.json({
      hasActiveSubscription: true,
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        renewalDate: subscription.renewalDate,
        daysRemaining: Math.ceil(
          (subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)
        ),
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const { publishEvent } = require("../middleware/eventNotification");
const requireAuth = require("../middleware/requireAuth");

router.post("/initialize", requireAuth, async (req, res) => {
  const { plan, amount, email } = req.body;

  if (!plan || !amount || !email) {
    return res.status(400).json({ error: "Plan, amount, and email are required" });
  }

  try {
    publishEvent('payment_events', 'payment.initialized', {
      userId: req.user._id,
      plan,
      amount,
      email,
      timestamp: new Date(),
    });

    res.json({
      message: "Payment initialized",
      reference: `ref_${Date.now()}`,
    });
  } catch (error) {
    console.error("Payment initialization error:", error);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

router.post("/verify", requireAuth, async (req, res) => {
  const { reference } = req.body;

  if (!reference) {
    return res.status(400).json({ error: "Reference is required" });
  }

  try {
    publishEvent('payment_events', 'payment.verified', {
      userId: req.user._id,
      reference,
      timestamp: new Date(),
    });

    res.json({
      message: "Payment verified successfully",
      status: "success",
    });
  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

router.post("/success", requireAuth, async (req, res) => {
  const { reference, plan } = req.body;

  try {
    publishEvent('payment_events', 'payment.success', {
      userId: req.user._id,
      reference,
      plan,
      email: req.user.email,
      timestamp: new Date(),
    });

    res.json({ message: "Payment success recorded" });
  } catch (error) {
    console.error("Payment success error:", error);
    res.status(500).json({ error: "Failed to record payment success" });
  }
});

router.post("/close", requireAuth, async (req, res) => {
  try {
    publishEvent('payment_events', 'payment.closed', {
      userId: req.user._id,
      timestamp: new Date(),
    });

    res.json({ message: "Payment closed" });
  } catch (error) {
    console.error("Payment close error:", error);
    res.status(500).json({ error: "Failed to record payment close" });
  }
});

module.exports = router;

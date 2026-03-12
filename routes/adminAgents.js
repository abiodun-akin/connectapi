const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../user");
const AgentApplication = require("../agentApplication");
const AgentWithdrawal = require("../agentWithdrawal");
const PromoCode = require("../promoCode");
const { ValidationError, NotFoundError, ConflictError } = require("../errors/AppError");

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("isAdmin");
    if (!user?.isAdmin) {
      return res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
    }
    next();
  } catch (error) {
    next(error);
  }
};

router.use(verifyAdmin);

router.get("/applications", async (req, res, next) => {
  try {
    const { status = "all" } = req.query;
    const query = status === "all" ? {} : { status };

    const applications = await AgentApplication.find(query)
      .sort({ createdAt: -1 })
      .populate("user_id", "name email")
      .populate("reviewedBy", "name email")
      .lean();

    res.json({ applications });
  } catch (error) {
    next(error);
  }
});

router.post("/applications/:id/review", async (req, res, next) => {
  try {
    const { decision, note = "" } = req.body;
    if (!["approved", "declined"].includes(decision)) {
      throw new ValidationError("Decision must be approved or declined", "decision");
    }

    const application = await AgentApplication.findById(req.params.id);
    if (!application) {
      throw new NotFoundError("Agent application");
    }

    if (application.status === decision) {
      throw new ConflictError(`Application is already ${decision}`);
    }

    application.status = decision;
    application.adminNote = String(note || "").trim();
    application.reviewedAt = new Date();
    application.reviewedBy = req.user._id;
    await application.save();

    await User.findByIdAndUpdate(application.user_id, {
      isAgent: decision === "approved",
      agentStatus: decision,
    });

    res.json({
      message: `Application ${decision}`,
      application,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:agentId/promo-codes", async (req, res, next) => {
  try {
    const {
      code,
      rebateType = "fixed",
      rebateValue,
      maxRedemptions = null,
      validTo = null,
    } = req.body;

    // Auto-generate code if not supplied, ensure uniqueness
    let promoCodeStr = String(code || "").trim().toUpperCase();
    if (!promoCodeStr) {
      let generated = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = "FC" + crypto.randomBytes(3).toString("hex").toUpperCase();
        const exists = await PromoCode.findOne({ code: candidate });
        if (!exists) {
          promoCodeStr = candidate;
          generated = true;
          break;
        }
      }
      if (!generated) {
        throw new ValidationError("Failed to generate a unique promo code — try again", "code");
      }
    } else if (promoCodeStr.length < 4) {
      throw new ValidationError("Promo code must be at least 4 characters", "code");
    }

    const rebate = Number(rebateValue);
    if (!Number.isFinite(rebate) || rebate < 0) {
      throw new ValidationError("Rebate value must be a valid positive number", "rebateValue");
    }

    if (!["fixed", "percentage"].includes(rebateType)) {
      throw new ValidationError("Invalid rebate type", "rebateType");
    }

    const agent = await User.findById(req.params.agentId).select("isAgent");
    if (!agent?.isAgent) {
      throw new ValidationError("Promo codes can only be assigned to approved agents", "agent");
    }

    const promoCode = await PromoCode.create({
      code: promoCodeStr,
      agent_id: req.params.agentId,
      createdBy: req.user._id,
      rebateType,
      rebateValue: rebate,
      maxRedemptions: maxRedemptions === null ? null : Number(maxRedemptions),
      validTo: validTo ? new Date(validTo) : null,
      status: "active",
    });

    res.status(201).json({
      message: "Promo code created successfully",
      promoCode,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:agentId/promo-codes", async (req, res, next) => {
  try {
    const promoCodes = await PromoCode.find({ agent_id: req.params.agentId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ promoCodes });
  } catch (error) {
    next(error);
  }
});

router.get("/withdrawals", async (req, res, next) => {
  try {
    const { status = "all" } = req.query;
    const query = status === "all" ? {} : { status };

    const withdrawals = await AgentWithdrawal.find(query)
      .sort({ createdAt: -1 })
      .populate("agent_id", "name email")
      .populate("reviewedBy", "name email")
      .lean();

    res.json({ withdrawals });
  } catch (error) {
    next(error);
  }
});

router.post("/withdrawals/:id/review", async (req, res, next) => {
  try {
    const { decision, note = "" } = req.body;
    if (!["approved", "declined", "paid"].includes(decision)) {
      throw new ValidationError("Decision must be approved, declined, or paid", "decision");
    }

    const withdrawal = await AgentWithdrawal.findById(req.params.id);
    if (!withdrawal) {
      throw new NotFoundError("Agent withdrawal");
    }

    if (withdrawal.status !== "pending" && decision !== "paid") {
      throw new ConflictError("Only pending withdrawals can be reviewed");
    }

    const user = await User.findById(withdrawal.agent_id);
    if (!user) {
      throw new NotFoundError("Agent user");
    }

    if (decision === "declined") {
      user.agentWallet.availableBalance += withdrawal.amount;
      user.agentWallet.lockedBalance -= withdrawal.amount;
      await user.save();
    }

    if (decision === "approved" || decision === "paid") {
      user.agentWallet.lockedBalance -= withdrawal.amount;
      user.agentWallet.lifetimeWithdrawn += withdrawal.amount;
      await user.save();
    }

    withdrawal.status = decision;
    withdrawal.adminNote = String(note || "").trim();
    withdrawal.reviewedAt = new Date();
    withdrawal.reviewedBy = req.user._id;
    await withdrawal.save();

    res.json({
      message: `Withdrawal ${decision}`,
      withdrawal,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

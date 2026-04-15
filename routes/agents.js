const express = require("express");
const router = express.Router();
const {
  emailVerificationRequired,
} = require("../middleware/emailVerificationRequired");
const User = require("../user");
const AgentApplication = require("../agentApplication");
const AgentWithdrawal = require("../agentWithdrawal");
const PromoCode = require("../promoCode");
const AgentLedger = require("../agentLedger");
const { validateRequest } = require("../validators/inputValidator");
const {
  ValidationError,
  ConflictError,
  NotFoundError,
} = require("../errors/AppError");

const applySchema = {
  motivation: (value) => {
    if (!value || typeof value !== "string" || value.trim().length < 20) {
      throw new ValidationError(
        "Motivation must be at least 20 characters",
        "motivation",
      );
    }
  },
};

const withdrawalSchema = {
  amount: (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError(
        "Withdrawal amount must be greater than zero",
        "amount",
      );
    }
  },
};

router.post(
  "/apply",
  emailVerificationRequired,
  validateRequest(applySchema),
  async (req, res, next) => {
    try {
      const { motivation, contactPhone = "" } = req.body;

      const [existing, user] = await Promise.all([
        AgentApplication.findOne({ user_id: req.user._id }),
        User.findById(req.user._id).select("isAgent agentStatus"),
      ]);

      if (
        user?.isAgent ||
        user?.agentStatus === "approved" ||
        existing?.status === "approved"
      ) {
        throw new ConflictError("You are already an approved agent");
      }

      if (existing?.status === "pending") {
        throw new ConflictError("You already have a pending agent application");
      }

      const application = await AgentApplication.findOneAndUpdate(
        { user_id: req.user._id },
        {
          motivation: motivation.trim(),
          contactPhone: String(contactPhone || "").trim(),
          status: "pending",
          adminNote: "",
          reviewedBy: null,
          reviewedAt: null,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      await User.findByIdAndUpdate(req.user._id, { agentStatus: "pending" });

      res.status(201).json({
        message: "Agent application submitted successfully",
        application,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/me", async (req, res, next) => {
  try {
    const [application, user, withdrawals] = await Promise.all([
      AgentApplication.findOne({ user_id: req.user._id }).lean(),
      User.findById(req.user._id)
        .select(
          "isAgent agentStatus agentWallet referredByAgentId referredPromoCode",
        )
        .lean(),
      AgentWithdrawal.find({ agent_id: req.user._id })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const codes = await PromoCode.find({ agent_id: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const recentLedger = await AgentLedger.find({ agent_id: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const agent = {
      isAgent: !!user?.isAgent,
      status: user?.agentStatus || application?.status || "none",
      wallet: user?.agentWallet || {
        availableBalance: 0,
        lockedBalance: 0,
        lifetimeEarned: 0,
        lifetimeWithdrawn: 0,
      },
    };

    res.json({
      agent,
      application,
      codes,
      recentLedger,
      withdrawals,
      isAgent: agent.isAgent,
      agentStatus: agent.status,
      agentWallet: agent.wallet,
      promoCodes: codes,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/promo-codes", async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select(
      "isAgent agentStatus",
    );
    if (!(user?.isAgent || user?.agentStatus === "approved")) {
      throw new ValidationError(
        "Only approved agents can view promo codes",
        "agent",
      );
    }

    const codes = await PromoCode.find({ agent_id: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ codes });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/withdrawals",
  emailVerificationRequired,
  validateRequest(withdrawalSchema),
  async (req, res, next) => {
    try {
      const minThreshold = Number(
        process.env.AGENT_WITHDRAWAL_THRESHOLD || 5000,
      );
      const amount = Number(req.body.amount);

      const user = await User.findById(req.user._id).select(
        "isAgent agentStatus agentWallet",
      );
      if (!(user?.isAgent || user?.agentStatus === "approved")) {
        throw new ValidationError(
          "Only approved agents can request withdrawals",
          "agent",
        );
      }

      if (amount < minThreshold) {
        throw new ValidationError(
          `Minimum withdrawal amount is ${minThreshold} NGN`,
          "amount",
        );
      }

      if ((user.agentWallet?.availableBalance || 0) < amount) {
        throw new ValidationError("Insufficient available balance", "amount");
      }

      const pending = await AgentWithdrawal.findOne({
        agent_id: req.user._id,
        status: "pending",
      });
      if (pending) {
        throw new ConflictError(
          "You already have a pending withdrawal request",
        );
      }

      const withdrawal = await AgentWithdrawal.create({
        agent_id: req.user._id,
        amount,
        status: "pending",
      });

      await User.findByIdAndUpdate(req.user._id, {
        $inc: {
          "agentWallet.availableBalance": -amount,
          "agentWallet.lockedBalance": amount,
        },
      });

      res.status(201).json({
        message: "Withdrawal request submitted",
        withdrawal,
        threshold: minThreshold,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/withdrawals", async (req, res, next) => {
  try {
    const withdrawals = await AgentWithdrawal.find({ agent_id: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ withdrawals });
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/withdrawals/:id",
  emailVerificationRequired,
  async (req, res, next) => {
    try {
      const withdrawal = await AgentWithdrawal.findOne({
        _id: req.params.id,
        agent_id: req.user._id,
        status: "pending",
      });

      if (!withdrawal) {
        throw new NotFoundError("Pending withdrawal request");
      }

      await AgentWithdrawal.findByIdAndUpdate(withdrawal._id, {
        status: "declined",
        adminNote: "Cancelled by agent",
        reviewedAt: new Date(),
        reviewedBy: req.user._id,
      });

      await User.findByIdAndUpdate(req.user._id, {
        $inc: {
          "agentWallet.availableBalance": withdrawal.amount,
          "agentWallet.lockedBalance": -withdrawal.amount,
        },
      });

      res.json({ message: "Withdrawal request cancelled" });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;

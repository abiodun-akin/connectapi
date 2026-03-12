const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../user");
const Subscription = require("../subscription");
const PromoCode = require("../promoCode");
const AgentLedger = require("../agentLedger");
const { publishEvent } = require("../middleware/eventNotification");
const { validateRequest, createValidationSchema } = require("../validators/inputValidator");
const { AuthenticationError, ConflictError, ValidationError } = require("../errors/AppError");

console.log("In auth routes");

// Validation schemas
const signupSchema = createValidationSchema("name", "email", "password");
const loginSchema = createValidationSchema("email", "password");

const applyPromoCodeOnSignup = async (promoCodeRaw, recruitUserId) => {
  if (!promoCodeRaw) {
    return null;
  }

  const promoCode = await PromoCode.getRedeemableCode(promoCodeRaw);
  if (!promoCode) {
    throw new ValidationError("Invalid or inactive promo code", "promoCode");
  }

  const incremented = await PromoCode.findOneAndUpdate(
    {
      _id: promoCode._id,
      status: "active",
      $expr: {
        $or: [
          { $eq: ["$maxRedemptions", null] },
          { $lt: ["$redemptionCount", "$maxRedemptions"] },
        ],
      },
    },
    { $inc: { redemptionCount: 1 } },
    { new: true }
  );

  if (!incremented) {
    throw new ValidationError("Promo code redemption limit reached", "promoCode");
  }

  const rebateAmount = Number(incremented.rebateValue || 0);

  await User.findByIdAndUpdate(incremented.agent_id, {
    $inc: {
      "agentWallet.availableBalance": rebateAmount,
      "agentWallet.lifetimeEarned": rebateAmount,
    },
  });

  await User.findByIdAndUpdate(recruitUserId, {
    referredByAgentId: incremented.agent_id,
    referredPromoCode: incremented.code,
  });

  await AgentLedger.create({
    agent_id: incremented.agent_id,
    recruit_id: recruitUserId,
    promoCode_id: incremented._id,
    promoCode: incremented.code,
    source: "signup",
    amount: rebateAmount,
    status: "accrued",
  });

  return {
    code: incremented.code,
    rebateAmount,
    agentId: incremented.agent_id,
  };
};

router.post("/signup", validateRequest(signupSchema), async (req, res, next) => {
  const { name, email, password, promoCode } = req.body;

  try {
    const user = await User.signup({ name, email, password });
    user.lastLogin = new Date();
    await user.save();

    const existingSub = await Subscription.findOne({
      user_id: user._id,
      status: { $in: ["active", "trial"] },
      endDate: { $gt: new Date() },
    });

    if (!existingSub) {
      await Subscription.createTrialSubscription(user._id, "basic");
    }

    const promoAttribution = await applyPromoCodeOnSignup(promoCode, user._id);

    const token = jwt.sign(
      { id: user._id },
      process.env.TOKEN_SECRET || "fallback-secret-for-dev-only",
      { expiresIn: process.env.TOKEN_EXPIRATION || "1d" }
    );

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    publishEvent("auth_events", "auth.signup", {
      userId: user._id,
      email: user.email,
      name: user.name,
      promoCode: promoAttribution?.code || null,
      rebateAmount: promoAttribution?.rebateAmount || 0,
    });

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin,
        isSuspended: user.isSuspended,
        referredPromoCode: promoAttribution?.code || null,
      },
      trial: {
        firstChargeAmount: 0,
        autoRenewalEnabled: true,
      },
      token,
    });
  } catch (error) {
    if (error.code === 11000) {
      return next(new ConflictError("Email already registered"));
    }
    next(error);
  }
});

router.post("/login", validateRequest(loginSchema), async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const user = await User.login({ email, password });
    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.TOKEN_SECRET || "fallback-secret-for-dev-only",
      { expiresIn: process.env.TOKEN_EXPIRATION || "1d" }
    );

    res.cookie("jwt", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    publishEvent("auth_events", "auth.login", {
      userId: user._id,
      email: user.email,
    });

    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        email: user.email,
        isAdmin: user.isAdmin,
        isSuspended: user.isSuspended,
      },
      token,
    });
  } catch (error) {
    next(new AuthenticationError("Invalid email or password"));
  }
});

router.post("/logout", async (req, res) => {
  let eventUser = null;
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1] || req.cookies.jwt;
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.id) {
        eventUser = await User.findById(decoded.id).select("_id email").lean();
      }
    }
  } catch (_err) {
    // Best-effort lookup only; logout should never fail because of notification data.
  }

  res.cookie("jwt", "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });

  publishEvent("auth_events", "auth.logout", {
    userId: eventUser?._id || null,
    email: eventUser?.email || null,
    timestamp: new Date(),
  });

  res.json({ message: "Logged out successfully" });
});

module.exports = router;

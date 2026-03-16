const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const User = require("../user");
const Subscription = require("../subscription");
const PromoCode = require("../promoCode");
const AgentLedger = require("../agentLedger");
const UserProfile = require("../userProfile");
const { publishEvent } = require("../middleware/eventNotification");
const { validateRequest, createValidationSchema } = require("../validators/inputValidator");
const {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} = require("../errors/AppError");

// Validation schemas
const signupSchema = createValidationSchema("name", "email", "password");
const loginSchema = createValidationSchema("email", "password");

const AUTH_TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || "1d";

const extractAuthToken = (req) => {
  const authHeader = req.headers.authorization;
  return authHeader?.split(" ")[1] || req.cookies.jwt || null;
};

const getTokenSecret = () => process.env.TOKEN_SECRET || "fallback-secret-for-dev-only";

const signAuthToken = (userId) => jwt.sign({ id: userId }, getTokenSecret(), {
  expiresIn: AUTH_TOKEN_EXPIRATION,
});

const setAuthCookie = (res, token) => {
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
};

const getRequestBaseUrl = (req) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto ? String(forwardedProto).split(",")[0].trim() : req.protocol;
  return `${protocol}://${req.get("host")}`;
};

const getFrontendOrigin = () => (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .trim()
  .replace(/\/+$/, "");

const getFrontendCallbackUrl = (params = {}) => {
  const url = new URL("/auth/social/callback", getFrontendOrigin());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const getSocialProviderConfig = (provider, req) => {
  if (provider === "google") {
    return {
      provider,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri:
        process.env.GOOGLE_OAUTH_REDIRECT_URI
        || `${getRequestBaseUrl(req)}/api/auth/social/google/callback`,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
      extraAuthParams: {
        prompt: "select_account",
      },
    };
  }

  if (provider === "microsoft") {
    const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID || "common";
    return {
      provider,
      clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET,
      redirectUri:
        process.env.MICROSOFT_OAUTH_REDIRECT_URI
        || `${getRequestBaseUrl(req)}/api/auth/social/microsoft/callback`,
      authorizationUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      userInfoUrl: "https://graph.microsoft.com/oidc/userinfo",
      scope: "openid email profile User.Read",
      extraAuthParams: {},
    };
  }

  return null;
};

const ensureProviderConfigured = (providerConfig) => {
  if (!providerConfig) {
    throw new ValidationError("Unsupported social provider", "provider");
  }

  if (!providerConfig.clientId || !providerConfig.clientSecret) {
    throw new ValidationError(
      `${providerConfig.provider} social sign-in is not configured`,
      providerConfig.provider
    );
  }
};

const sanitizeDisplayName = (name, email) => {
  const cleaned = String(name || "")
    .replace(/[^A-Za-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned) {
    return cleaned;
  }

  const emailPrefix = String(email || "FarmConnect User")
    .split("@")[0]
    .replace(/[^A-Za-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return emailPrefix || "FarmConnect User";
};

const serializeAuthUser = async (user) => {
  const profile = await UserProfile.findOne({ user_id: user._id })
    .select("profileType isProfileComplete profileImageUrl")
    .lean();

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin,
    isSuspended: user.isSuspended,
    isAgent: Boolean(user.isAgent),
    agentStatus: user.agentStatus || "none",
    profileType: profile?.profileType || null,
    isProfileComplete: Boolean(profile?.isProfileComplete),
    profileImageUrl: profile?.profileImageUrl || null,
    authProvider: user.googleId && user.microsoftId
      ? "multiple"
      : user.googleId
        ? "google"
        : user.microsoftId
          ? "microsoft"
          : "local",
  };
};

const resolveAuthenticatedSession = async (req) => {
  const token = extractAuthToken(req);

  if (!token) {
    throw new AuthenticationError("No authentication token provided");
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, getTokenSecret());
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new AuthorizationError("Token has expired. Please login again.");
    }

    throw new AuthenticationError("Invalid authentication token");
  }

  const user = await User.findById(decodedToken.id);
  if (!user) {
    throw new AuthenticationError("User not found");
  }

  if (user.isSuspended) {
    throw new AuthorizationError("Account suspended");
  }

  return { user, token };
};

const exchangeAuthorizationCode = async (providerConfig, code) => {
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: providerConfig.clientId,
    client_secret: providerConfig.clientSecret,
    redirect_uri: providerConfig.redirectUri,
  });

  const response = await axios.post(providerConfig.tokenUrl, payload.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
};

const fetchSocialProfile = async (providerConfig, accessToken) => {
  const response = await axios.get(providerConfig.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const profile = response.data || {};
  const email = String(profile.email || profile.preferred_username || "")
    .trim()
    .toLowerCase();

  if (!email) {
    throw new AuthenticationError("Unable to resolve email from social account");
  }

  return {
    id: String(profile.sub || profile.id || "").trim(),
    email,
    name: String(profile.name || `${profile.given_name || ""} ${profile.family_name || ""}`)
      .replace(/\s+/g, " ")
      .trim(),
  };
};

const ensureTrialSubscription = async (userId) => {
  const existingSub = await Subscription.findOne({
    user_id: userId,
    status: { $in: ["active", "trial"] },
    endDate: { $gt: new Date() },
  });

  if (!existingSub) {
    await Subscription.createTrialSubscription(userId, "basic");
  }
};

const findOrCreateSocialUser = async (provider, profile) => {
  const providerField = provider === "google" ? "googleId" : "microsoftId";
  let user = await User.findOne({ [providerField]: profile.id });
  let isNewUser = false;

  if (!user) {
    user = await User.findOne({ email: profile.email });
  }

  if (!user) {
    const randomPassword = `Social${crypto.randomBytes(16).toString("hex")}A1`;
    const hashedPassword = await bcrypt.hash(randomPassword, 12);
    user = await User.create({
      name: sanitizeDisplayName(profile.name, profile.email),
      email: profile.email,
      password: hashedPassword,
      [providerField]: profile.id,
      lastLogin: new Date(),
    });
    isNewUser = true;
  } else {
    if (profile.id && user[providerField] && user[providerField] !== profile.id) {
      throw new ConflictError(`This ${provider} account is already linked to another user`);
    }

    user[providerField] = user[providerField] || profile.id;
    user.name = user.name || sanitizeDisplayName(profile.name, profile.email);
    user.lastLogin = new Date();
    await user.save();
  }

  return { user, isNewUser };
};

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

    await ensureTrialSubscription(user._id);

    const promoAttribution = await applyPromoCodeOnSignup(promoCode, user._id);

    const token = signAuthToken(user._id);
    setAuthCookie(res, token);

    const authUser = await serializeAuthUser(user);

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
        ...authUser,
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

    const token = signAuthToken(user._id);
    setAuthCookie(res, token);

    const authUser = await serializeAuthUser(user);

    publishEvent("auth_events", "auth.login", {
      userId: user._id,
      email: user.email,
    });

    res.json({
      message: "Login successful",
      user: authUser,
      token,
    });
  } catch (error) {
    next(new AuthenticationError("Invalid email or password"));
  }
});

router.get("/session", async (req, res, next) => {
  try {
    const { user, token } = await resolveAuthenticatedSession(req);
    const authUser = await serializeAuthUser(user);

    res.json({
      message: "Session active",
      user: authUser,
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/social/:provider/start", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();
  const mode = req.query.mode === "signup" ? "signup" : "login";

  try {
    const providerConfig = getSocialProviderConfig(provider, req);
    ensureProviderConfigured(providerConfig);

    const state = jwt.sign(
      {
        provider,
        mode,
        nonce: crypto.randomBytes(12).toString("hex"),
      },
      getTokenSecret(),
      { expiresIn: "15m" }
    );

    const authorizationUrl = new URL(providerConfig.authorizationUrl);
    authorizationUrl.searchParams.set("client_id", providerConfig.clientId);
    authorizationUrl.searchParams.set("redirect_uri", providerConfig.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", providerConfig.scope);
    authorizationUrl.searchParams.set("state", state);

    Object.entries(providerConfig.extraAuthParams || {}).forEach(([key, value]) => {
      authorizationUrl.searchParams.set(key, value);
    });

    return res.redirect(authorizationUrl.toString());
  } catch (error) {
    const redirectUrl = getFrontendCallbackUrl({
      provider,
      mode,
      error: error.message || "Unable to start social sign-in",
    });
    return res.redirect(redirectUrl);
  }
});

router.get("/social/:provider/callback", async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();

  try {
    const providerConfig = getSocialProviderConfig(provider, req);
    ensureProviderConfigured(providerConfig);

    if (req.query.error) {
      throw new AuthenticationError(String(req.query.error_description || req.query.error));
    }

    if (!req.query.code || !req.query.state) {
      throw new AuthenticationError("Social authentication was not completed");
    }

    const state = jwt.verify(String(req.query.state), getTokenSecret());
    if (state.provider !== provider) {
      throw new AuthenticationError("Invalid social authentication state");
    }

    const tokenSet = await exchangeAuthorizationCode(providerConfig, String(req.query.code));
    const profile = await fetchSocialProfile(providerConfig, tokenSet.access_token);
    const { user, isNewUser } = await findOrCreateSocialUser(provider, profile);

    if (user.isSuspended) {
      throw new AuthorizationError("Account suspended");
    }

    if (isNewUser) {
      await ensureTrialSubscription(user._id);
    }

    const token = signAuthToken(user._id);
    setAuthCookie(res, token);

    publishEvent("auth_events", isNewUser ? "auth.signup" : "auth.login", {
      userId: user._id,
      email: user.email,
      name: user.name,
      provider,
    });

    return res.redirect(
      getFrontendCallbackUrl({
        provider,
        mode: state.mode,
        status: "success",
        newUser: isNewUser,
      })
    );
  } catch (error) {
    return res.redirect(
      getFrontendCallbackUrl({
        provider,
        error: error.message || "Social authentication failed",
      })
    );
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

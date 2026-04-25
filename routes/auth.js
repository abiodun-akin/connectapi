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
const AuditLog = require("../auditLog");
const { publishEvent } = require("../middleware/eventNotification");
const {
  validateRequest,
  createValidationSchema,
  validationRules,
} = require("../validators/inputValidator");
const {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} = require("../errors/AppError");

// Validation schemas
const signupSchema = createValidationSchema("name", "email", "password");
const loginSchema = createValidationSchema("email", "password");
const forgotPasswordSchema = createValidationSchema("email");
const resetPasswordSchema = {
  token: (token) => {
    if (!token || typeof token !== "string" || token.trim().length < 20) {
      throw new ValidationError("Valid reset token is required", "token");
    }
  },
  password: validationRules.password,
};
const verifyEmailSchema = {
  token: (token) => {
    if (!token || typeof token !== "string" || token.trim().length < 20) {
      throw new ValidationError(
        "Valid verification token is required",
        "token",
      );
    }
  },
};

const AUTH_TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || "1d";
const TWO_FACTOR_CHALLENGE_EXPIRATION = "10m";
const TWO_FACTOR_CODE_EXPIRY_MS = 10 * 60 * 1000;
const TWO_FACTOR_MAX_ATTEMPTS = 5;

const extractAuthToken = (req) => {
  const authHeader = req.headers.authorization;
  return authHeader?.split(" ")[1] || req.cookies.jwt || null;
};

const getTokenSecret = () =>
  process.env.TOKEN_SECRET || "fallback-secret-for-dev-only";

const signAuthToken = (userId) =>
  jwt.sign({ id: userId }, getTokenSecret(), {
    expiresIn: AUTH_TOKEN_EXPIRATION,
  });

const setAuthCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: isProduction, // Required when sameSite is "none"
    sameSite: isProduction ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000,
  });
};

const getRequestBaseUrl = (req) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto
    ? String(forwardedProto).split(",")[0].trim()
    : req.protocol;
  return `${protocol}://${req.get("host")}`;
};

const getFrontendOrigin = () => {
  // Always use environment variable - no hardcoded URLs
  let origin = process.env.FRONTEND_ORIGIN;

  if (!origin) {
    throw new Error(
      "FRONTEND_ORIGIN environment variable is not set. " +
        "Set it to your frontend URL (e.g., https://farmapp.kwezitechnologiesltd.africa or http://localhost:80)",
    );
  }

  return origin.trim().replace(/\/+$/, "");
};

const getFrontendCallbackUrl = (params = {}) => {
  const url = new URL("/auth/social/callback", getFrontendOrigin());
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const getPasswordResetUrl = (token) => {
  const url = new URL("/reset-password", getFrontendOrigin());
  url.searchParams.set("token", token);
  return url.toString();
};

const getEmailVerificationUrl = (token) => {
  const url = new URL("/verify-email", getFrontendOrigin());
  url.searchParams.set("token", token);
  return url.toString();
};

const hashToken = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const generateTwoFactorCode = () =>
  String(Math.floor(100000 + Math.random() * 900000));

const signTwoFactorChallenge = (userId) =>
  jwt.sign({ id: userId, purpose: "two-factor" }, getTokenSecret(), {
    expiresIn: TWO_FACTOR_CHALLENGE_EXPIRATION,
  });

const buildAuthEventMetadata = (req, extra = {}) => {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const ipAddress = forwardedFor || req.ip || req.socket?.remoteAddress || null;

  return {
    timestamp: new Date().toISOString(),
    ipAddress,
    userAgent: req.get("user-agent") || null,
    requestId:
      req.get("x-request-id") ||
      req.get("x-correlation-id") ||
      crypto.randomUUID(),
    method: req.method,
    path: req.originalUrl,
    location: {
      country:
        req.get("cf-ipcountry") ||
        req.get("x-vercel-ip-country") ||
        req.get("x-country") ||
        null,
      region:
        req.get("x-vercel-ip-country-region") || req.get("x-region") || null,
      city: req.get("x-vercel-ip-city") || req.get("x-city") || null,
    },
    ...extra,
  };
};

const getSocialProviderConfig = (provider, req) => {
  if (provider === "google") {
    return {
      provider,
      clientId:
        process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      clientSecret:
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET,
      redirectUri:
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        `${getRequestBaseUrl(req)}/api/auth/social/google/callback`,
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
        process.env.MICROSOFT_OAUTH_REDIRECT_URI ||
        `${getRequestBaseUrl(req)}/api/auth/social/microsoft/callback`,
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
      providerConfig.provider,
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
    isEmailVerified: Boolean(user.isEmailVerified),
    isAdmin: user.isAdmin,
    isSuspended: user.isSuspended,
    isAgent: Boolean(user.isAgent),
    agentStatus: user.agentStatus || "none",
    profileType: profile?.profileType || null,
    isProfileComplete: Boolean(profile?.isProfileComplete),
    profileImageUrl: profile?.profileImageUrl || null,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    authProvider:
      user.googleId && user.microsoftId
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

  if (
    user.passwordChangedAt &&
    decodedToken.iat &&
    user.passwordChangedAt.getTime() > decodedToken.iat * 1000
  ) {
    throw new AuthorizationError("Password changed. Please login again.");
  }

  return { user, token };
};

const resolveRefreshSession = async (req) => {
  const token = extractAuthToken(req);

  if (!token) {
    throw new AuthenticationError("No authentication token provided");
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, getTokenSecret(), {
      ignoreExpiration: true,
    });
  } catch (_error) {
    throw new AuthenticationError("Invalid authentication token");
  }

  const refreshGraceSeconds = Number(
    process.env.REFRESH_GRACE_SECONDS || 7 * 24 * 60 * 60,
  );
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    Number.isFinite(refreshGraceSeconds) &&
    decodedToken.exp &&
    nowSeconds > decodedToken.exp + refreshGraceSeconds
  ) {
    throw new AuthorizationError(
      "Session is too old to refresh. Please login again.",
    );
  }

  const user = await User.findById(decodedToken.id);
  if (!user) {
    throw new AuthenticationError("User not found");
  }

  if (user.isSuspended) {
    throw new AuthorizationError("Account suspended");
  }

  if (
    user.passwordChangedAt &&
    decodedToken.iat &&
    user.passwordChangedAt.getTime() > decodedToken.iat * 1000
  ) {
    throw new AuthorizationError("Password changed. Please login again.");
  }

  const refreshedToken = signAuthToken(user._id);
  return { user, token: refreshedToken };
};

const exchangeAuthorizationCode = async (providerConfig, code) => {
  const payload = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: providerConfig.clientId,
    client_secret: providerConfig.clientSecret,
    redirect_uri: providerConfig.redirectUri,
  });

  const response = await axios.post(
    providerConfig.tokenUrl,
    payload.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );

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
    throw new AuthenticationError(
      "Unable to resolve email from social account",
    );
  }

  return {
    id: String(profile.sub || profile.id || "").trim(),
    email,
    name: String(
      profile.name ||
        `${profile.given_name || ""} ${profile.family_name || ""}`,
    )
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
    await Subscription.createTrialSubscription(userId, "premium");
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
    if (
      profile.id &&
      user[providerField] &&
      user[providerField] !== profile.id
    ) {
      throw new ConflictError(
        `This ${provider} account is already linked to another user`,
      );
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
    { new: true },
  );

  if (!incremented) {
    throw new ValidationError(
      "Promo code redemption limit reached",
      "promoCode",
    );
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

router.post(
  "/signup",
  validateRequest(signupSchema),
  async (req, res, next) => {
    const { name, email, password, promoCode } = req.body;

    try {
      const user = await User.signup({ name, email, password });
      user.lastLogin = new Date();
      const verifyToken = user.createEmailVerificationToken();
      await user.save();

      await ensureTrialSubscription(user._id);

      const promoAttribution = await applyPromoCodeOnSignup(
        promoCode,
        user._id,
      );

      const token = signAuthToken(user._id);
      setAuthCookie(res, token);

      const authUser = await serializeAuthUser(user);

      publishEvent("auth_events", "auth.signup", {
        userId: user._id,
        email: user.email,
        name: user.name,
        promoCode: promoAttribution?.code || null,
        rebateAmount: promoAttribution?.rebateAmount || 0,
        ...buildAuthEventMetadata(req, {
          authMethod: "password",
        }),
      });

      publishEvent("auth_events", "auth.email_verification_requested", {
        userId: user._id,
        email: user.email,
        name: user.name,
        verifyUrl: getEmailVerificationUrl(verifyToken),
        expiresInHours: 24,
      });

      // Log audit event
      await AuditLog.logAction({
        userId: user._id,
        action: "SIGNUP",
        resource: "USER",
        resourceId: user._id,
        details: {
          authMethod: "password",
          promoCode: promoAttribution?.code || null,
          ipAddress: req.ip,
          userAgent: req.get("User-Agent"),
        },
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
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
      console.error("[SIGNUP ERROR] Caught error:", {
        code: error.code,
        message: error.message,
        field: error.keyPattern ? Object.keys(error.keyPattern)[0] : null,
        keyPattern: error.keyPattern,
        keyValue: error.keyValue,
        name: error.name,
      });

      if (error.code === 11000) {
        const field = error.keyPattern
          ? Object.keys(error.keyPattern)[0]
          : "email";
        const dupError = new ConflictError(`${field} already registered`);
        console.error(
          "[SIGNUP ERROR] Returning conflict error:",
          dupError.message,
        );
        return next(dupError);
      }
      next(error);
    }
  },
);

router.post("/login", validateRequest(loginSchema), async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const user = await User.login({ email, password });

    if (user.twoFactorEnabled) {
      const code = generateTwoFactorCode();
      user.twoFactorCodeHash = hashToken(code);
      user.twoFactorCodeExpiresAt = new Date(
        Date.now() + TWO_FACTOR_CODE_EXPIRY_MS,
      );
      user.twoFactorAttemptCount = 0;
      await user.save();

      const challengeToken = signTwoFactorChallenge(user._id);

      publishEvent("auth_events", "auth.two_factor_requested", {
        userId: user._id,
        email: user.email,
        name: user.name,
        code,
        expiresInMinutes: 10,
        ...buildAuthEventMetadata(req, {
          authMethod: "password+2fa",
        }),
      });

      return res.status(202).json({
        message: "Two-factor authentication code sent",
        requiresTwoFactor: true,
        challengeToken,
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signAuthToken(user._id);
    setAuthCookie(res, token);

    const authUser = await serializeAuthUser(user);

    publishEvent("auth_events", "auth.login", {
      userId: user._id,
      email: user.email,
      ...buildAuthEventMetadata(req, {
        authMethod: "password",
      }),
    });

    // Log audit event
    await AuditLog.logAction({
      userId: user._id,
      action: "LOGIN",
      resource: "USER",
      resourceId: user._id,
      details: {
        authMethod: "password",
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
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

router.post("/2fa/verify", async (req, res, next) => {
  const { challengeToken, code } = req.body || {};

  try {
    if (!challengeToken || typeof challengeToken !== "string") {
      throw new ValidationError(
        "Challenge token is required",
        "challengeToken",
      );
    }

    if (!code || typeof code !== "string") {
      throw new ValidationError("A valid code is required", "code");
    }

    let decoded;
    try {
      decoded = jwt.verify(challengeToken, getTokenSecret());
    } catch (_error) {
      throw new AuthorizationError("Two-factor challenge has expired");
    }

    if (decoded.purpose !== "two-factor") {
      throw new AuthorizationError("Invalid two-factor challenge");
    }

    const user = await User.findById(decoded.id).select(
      "+twoFactorCodeHash +twoFactorCodeExpiresAt +twoFactorAttemptCount +twoFactorRecoveryCodes +twoFactorSecret",
    );

    if (!user || !user.twoFactorEnabled) {
      throw new AuthenticationError(
        "User not available for two-factor verification",
      );
    }

    // Check if code is a recovery code (8-char hex uppercase)
    const isRecoveryCode = /^[A-F0-9]{8}$/.test(
      String(code).trim().toUpperCase(),
    );

    if (isRecoveryCode) {
      // Validate recovery code
      const codeToCheck = String(code).trim().toUpperCase();
      if (!user.validateRecoveryCode(codeToCheck)) {
        throw new AuthenticationError("Invalid or already-used recovery code");
      }
    } else if (/^\d{6}$/.test(String(code))) {
      // Could be email-based code or TOTP code
      const codeStr = String(code).trim();
      let isValid = false;

      // Try TOTP verification first if secret exists
      if (user.twoFactorSecret) {
        if (user.verifyTOTPCode(codeStr)) {
          isValid = true;
        }
      }

      // Fall back to email code verification if TOTP failed or not set up
      if (!isValid && user.twoFactorCodeHash && user.twoFactorCodeExpiresAt) {
        if (
          new Date(user.twoFactorCodeExpiresAt) > new Date() &&
          hashToken(codeStr) === user.twoFactorCodeHash
        ) {
          isValid = true;
        } else if (new Date(user.twoFactorCodeExpiresAt) <= new Date()) {
          user.twoFactorCodeHash = null;
          user.twoFactorCodeExpiresAt = null;
          user.twoFactorAttemptCount = 0;
          await user.save();
          throw new AuthorizationError("Two-factor code has expired");
        } else {
          // Invalid email code attempt
          if ((user.twoFactorAttemptCount || 0) >= TWO_FACTOR_MAX_ATTEMPTS) {
            user.twoFactorCodeHash = null;
            user.twoFactorCodeExpiresAt = null;
            user.twoFactorAttemptCount = 0;
            await user.save();
            throw new AuthorizationError(
              "Too many invalid attempts. Please login again.",
            );
          }
          user.twoFactorAttemptCount = (user.twoFactorAttemptCount || 0) + 1;
          await user.save();
          throw new AuthenticationError("Invalid two-factor code");
        }
      }

      if (!isValid) {
        throw new AuthenticationError("Invalid two-factor code");
      }
    } else {
      throw new ValidationError(
        "A valid 6-digit code or recovery code is required",
        "code",
      );
    }

    user.twoFactorCodeHash = null;
    user.twoFactorCodeExpiresAt = null;
    user.twoFactorAttemptCount = 0;
    user.lastLogin = new Date();
    await user.save();

    const token = signAuthToken(user._id);
    setAuthCookie(res, token);
    const authUser = await serializeAuthUser(user);

    publishEvent("auth_events", "auth.login", {
      userId: user._id,
      email: user.email,
      ...buildAuthEventMetadata(req, {
        authMethod: "2fa",
      }),
    });

    res.json({
      message: "Two-factor verification successful",
      user: authUser,
      token,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/2fa/enable", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);
    user.twoFactorEnabled = true;
    user.twoFactorCodeHash = null;
    user.twoFactorCodeExpiresAt = null;
    user.twoFactorAttemptCount = 0;

    // Generate recovery codes
    const plainCodes = User.generateRecoveryCodes();
    user.setRecoveryCodes(plainCodes);

    await user.save();

    res.json({
      message: "Two-factor authentication enabled",
      recoveryCodes: plainCodes,
      status:
        "Store these codes in a safe place. Each code can be used once if you lose access to your authenticator app.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/2fa/disable", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);
    user.twoFactorEnabled = false;
    user.twoFactorCodeHash = null;
    user.twoFactorCodeExpiresAt = null;
    user.twoFactorAttemptCount = 0;
    user.twoFactorRecoveryCodes = [];
    user.twoFactorRecoveryCodesGeneratedAt = null;
    await user.save();

    res.json({ message: "Two-factor authentication disabled" });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /2fa/recovery-codes
 * Get recovery code status (count and remaining)
 */
router.get("/2fa/recovery-codes", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);
    const status = user.getRecoveryCodeStatus();
    res.json({
      recoveryCodes: status,
      message: `You have ${status.remaining} recovery codes remaining`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /2fa/recovery-codes/regenerate
 * Generate new recovery codes (invalidates old ones)
 */
router.post("/2fa/recovery-codes/regenerate", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);

    if (!user.twoFactorEnabled) {
      throw new ValidationError(
        "Two-factor authentication is not enabled",
        "twoFactor",
      );
    }

    const plainCodes = User.generateRecoveryCodes();
    user.setRecoveryCodes(plainCodes);
    await user.save();

    res.json({
      recoveryCodes: plainCodes,
      message: "New recovery codes generated. Store them in a safe place.",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /2fa/recovery-codes/send-email
 * Send recovery codes to user's email for backup
 */
router.post("/2fa/recovery-codes/send-email", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);

    if (!user.twoFactorEnabled) {
      throw new ValidationError(
        "Two-factor authentication is not enabled",
        "twoFactor",
      );
    }

    const status = user.getRecoveryCodeStatus();
    if (!status || status.total === 0) {
      throw new ValidationError(
        "No recovery codes available to send",
        "recoveryCodes",
      );
    }

    // Publish event for async email sending
    publishEvent("auth_events", "auth.recovery_codes_email_requested", {
      userId: user._id.toString(),
      email: user.email,
      timestamp: new Date(),
    });

    res.json({
      message: "Recovery codes email has been queued for sending",
      email: user.email,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /2fa/setup
 * Generate TOTP secret and QR code for authenticator app setup
 */
router.post("/2fa/setup", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);
    const { method } = req.body || {};

    // Generate TOTP secret
    const secret = user.generateTOTPSecret();
    await user.save();

    const { getTOTPSetupResponse } = require("../utils/totpUtils");
    const setupResponse = await getTOTPSetupResponse(secret, user.email);

    res.json({
      message: "TOTP setup initiated",
      method: method || "authenticator",
      qrCode: setupResponse.qrCode,
      secret: setupResponse.secret,
      manualEntryKey: setupResponse.manualEntryKey,
      instructions:
        "Scan this QR code with your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.)",
      backupSecret:
        "If you can't scan the QR code, enter this key manually in your app",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /2fa/setup/verify
 * Verify TOTP setup by confirming user can generate correct code
 */
router.post("/2fa/setup/verify", async (req, res, next) => {
  try {
    let { user } = await resolveAuthenticatedSession(req);
    const { totpCode } = req.body || {};

    if (!totpCode || !/^\d{6}$/.test(String(totpCode))) {
      throw new ValidationError(
        "Valid 6-digit TOTP code is required",
        "totpCode",
      );
    }

    // Re-fetch user with twoFactorSecret field (it's hidden by default)
    user = await User.findById(user._id).select("+twoFactorSecret");
    if (!user.twoFactorSecret) {
      throw new ValidationError(
        "TOTP setup has not been initiated",
        "twoFactor",
      );
    }

    // Verify TOTP code
    if (!user.verifyTOTPCode(String(totpCode))) {
      throw new AuthenticationError("Invalid TOTP code. Please try again.");
    }

    // Setup successful - generate recovery codes
    user.twoFactorEnabled = true;
    user.twoFactorMethod = "authenticator";
    const plainCodes = User.generateRecoveryCodes();
    user.setRecoveryCodes(plainCodes);
    await user.save();

    res.json({
      message: "Two-factor authentication enabled successfully",
      recoveryCodes: plainCodes,
      method: "authenticator",
      status:
        "Store these recovery codes in a safe place. You'll need them if you lose access to your authenticator app.",
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /2fa/method
 * Switch between email and authenticator as primary 2FA method
 */
router.put("/2fa/method", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);
    const { method } = req.body || {};

    if (!["email", "authenticator"].includes(method)) {
      throw new ValidationError(
        "Method must be 'email' or 'authenticator'",
        "method",
      );
    }

    if (!user.twoFactorEnabled) {
      throw new ValidationError(
        "Two-factor authentication is not enabled",
        "twoFactor",
      );
    }

    if (method === "authenticator" && !user.twoFactorSecret) {
      throw new ValidationError(
        "Authenticator app is not set up yet",
        "method",
      );
    }

    user.twoFactorMethod = method;
    await user.save();

    res.json({
      message: `Two-factor method changed to ${method}`,
      method,
      twoFactorEnabled: true,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/forgot-password",
  validateRequest(forgotPasswordSchema),
  async (req, res, next) => {
    const { email } = req.body;
    const responseMessage =
      "If an account exists for that email, a password reset link has been sent.";

    try {
      const user = await User.findOne({
        email: String(email).trim().toLowerCase(),
      });

      if (user) {
        const resetToken = user.createPasswordResetToken();
        await user.save();

        publishEvent("auth_events", "auth.password_reset_requested", {
          userId: user._id,
          email: user.email,
          name: user.name,
          resetUrl: getPasswordResetUrl(resetToken),
          expiresInMinutes: 30,
          ...buildAuthEventMetadata(req, {
            authMethod: "password_reset",
          }),
        });
      }

      res.json({ message: responseMessage });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/reset-password",
  validateRequest(resetPasswordSchema),
  async (req, res, next) => {
    const { token, password } = req.body;

    try {
      const user = await User.findOne({
        resetPasswordTokenHash: hashToken(token),
        resetPasswordExpiresAt: { $gt: new Date() },
      });

      if (!user) {
        throw new ValidationError(
          "Reset link is invalid or has expired",
          "token",
        );
      }

      user.password = await bcrypt.hash(password, 12);
      user.passwordChangedAt = new Date();
      user.resetPasswordTokenHash = null;
      user.resetPasswordExpiresAt = null;
      await user.save();

      res.cookie("jwt", "", {
        httpOnly: true,
        maxAge: 0,
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      });

      publishEvent("auth_events", "auth.password_reset_completed", {
        userId: user._id,
        email: user.email,
        name: user.name,
        ...buildAuthEventMetadata(req, {
          authMethod: "password_reset",
        }),
      });

      res.json({ message: "Password reset successful. Please sign in again." });
    } catch (error) {
      next(error);
    }
  },
);

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

router.post("/refresh", async (req, res, next) => {
  try {
    const { user, token } = await resolveRefreshSession(req);
    const authUser = await serializeAuthUser(user);

    setAuthCookie(res, token);

    publishEvent("auth_events", "auth.refresh", {
      userId: user._id,
      email: user.email,
      ...buildAuthEventMetadata(req, {
        authMethod: "refresh",
      }),
    });

    res.json({
      message: "Session refreshed",
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
      { expiresIn: "15m" },
    );

    const authorizationUrl = new URL(providerConfig.authorizationUrl);
    authorizationUrl.searchParams.set("client_id", providerConfig.clientId);
    authorizationUrl.searchParams.set(
      "redirect_uri",
      providerConfig.redirectUri,
    );
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", providerConfig.scope);
    authorizationUrl.searchParams.set("state", state);

    Object.entries(providerConfig.extraAuthParams || {}).forEach(
      ([key, value]) => {
        authorizationUrl.searchParams.set(key, value);
      },
    );

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
      throw new AuthenticationError(
        String(req.query.error_description || req.query.error),
      );
    }

    if (!req.query.code || !req.query.state) {
      throw new AuthenticationError("Social authentication was not completed");
    }

    const state = jwt.verify(String(req.query.state), getTokenSecret());
    if (state.provider !== provider) {
      throw new AuthenticationError("Invalid social authentication state");
    }

    const tokenSet = await exchangeAuthorizationCode(
      providerConfig,
      String(req.query.code),
    );
    const profile = await fetchSocialProfile(
      providerConfig,
      tokenSet.access_token,
    );
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
      ...buildAuthEventMetadata(req, {
        authMethod: provider,
      }),
    });

    // Log audit event
    await AuditLog.logAction({
      userId: user._id,
      action: isNewUser ? "SIGNUP" : "LOGIN",
      resource: "USER",
      resourceId: user._id,
      details: {
        authMethod: provider,
        provider,
        isNewUser,
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
      },
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
    });

    return res.redirect(
      getFrontendCallbackUrl({
        provider,
        mode: state.mode,
        status: "success",
        newUser: isNewUser,
      }),
    );
  } catch (error) {
    return res.redirect(
      getFrontendCallbackUrl({
        provider,
        error: error.message || "Social authentication failed",
      }),
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
    ...buildAuthEventMetadata(req, {
      authMethod: "session",
    }),
  });

  res.json({ message: "Logged out successfully" });
});

router.post("/send-verification", async (req, res, next) => {
  try {
    const { user } = await resolveAuthenticatedSession(req);

    if (user.isEmailVerified) {
      return res.json({ message: "Email is already verified." });
    }

    const COOLDOWN_MS = 2 * 60 * 1000;
    if (
      user.emailVerificationLastSentAt &&
      Date.now() - user.emailVerificationLastSentAt.getTime() < COOLDOWN_MS
    ) {
      const secondsLeft = Math.ceil(
        (COOLDOWN_MS -
          (Date.now() - user.emailVerificationLastSentAt.getTime())) /
          1000,
      );
      return next(
        new ValidationError(
          `Please wait ${secondsLeft} seconds before requesting another verification email.`,
          "cooldown",
        ),
      );
    }

    const verifyToken = user.createEmailVerificationToken();
    await user.save();

    publishEvent("auth_events", "auth.email_verification_requested", {
      userId: user._id,
      email: user.email,
      name: user.name,
      verifyUrl: getEmailVerificationUrl(verifyToken),
      expiresInHours: 24,
      ...buildAuthEventMetadata(req, { authMethod: "email_verification" }),
    });

    res.json({ message: "Verification email sent. Please check your inbox." });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/verify-email",
  validateRequest(verifyEmailSchema),
  async (req, res, next) => {
    const { token } = req.body;

    try {
      const tokenHash = hashToken(token);
      const user = await User.findOne({
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { $gt: new Date() },
      });

      if (!user) {
        throw new ValidationError(
          "Verification link is invalid or has expired.",
          "token",
        );
      }

      user.isEmailVerified = true;
      user.emailVerificationTokenHash = null;
      user.emailVerificationExpiresAt = null;
      await user.save();

      let authUser;
      try {
        authUser = await serializeAuthUser(user);
      } catch (_error) {
        // Fallback for partial user objects in tests or edge-cases where related
        // profile data is unavailable; email verification should still succeed.
        authUser = {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileType: user.profileType,
          isEmailVerified: user.isEmailVerified,
        };
      }
      const newToken = signAuthToken(user._id);

      res.json({
        message:
          "Email verified successfully. You can now access all features.",
        user: authUser,
        token: newToken,
      });
    } catch (error) {
      next(error);
    }
  },
);

// Development-only endpoint for testing email verification flow
if (process.env.NODE_ENV !== "production") {
  router.get("/dev/verification-token/:email", async (req, res, next) => {
    try {
      const email = String(req.params.email).trim().toLowerCase();
      const user = await User.findOne({ email });

      if (!user) {
        return res.status(404).json({
          error: "User not found",
          email,
        });
      }

      const verifyToken = user.createEmailVerificationToken();
      await user.save();

      res.json({
        message: "Verification token generated for testing",
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        verificationToken: verifyToken,
        note: "Use this token with POST /api/auth/verify-email",
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = router;

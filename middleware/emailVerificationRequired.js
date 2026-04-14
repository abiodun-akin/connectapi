/**
 * Middleware to enforce email verification for protected routes
 * Blocks users from accessing functional features without verified email
 */

const { AuthenticationError } = require("../errors/AppError");

/**
 * Check if user's email is verified
 * If not, reject the request with 403 Forbidden
 */
const emailVerificationRequired = (req, res, next) => {
  if (!req.user) {
    return next(new AuthenticationError("Not authenticated"));
  }

  if (!req.user.isEmailVerified) {
    return res.status(403).json({
      error: "Email verification required",
      code: "EMAIL_NOT_VERIFIED",
      message:
        "Please verify your email before accessing this feature. Check your inbox for verification email.",
      userEmail: req.user.email,
    });
  }

  next();
};

/**
 * Optional: WARNING middleware that logs but doesn't block
 * Useful for analytics/tracking unverified users attempting actions
 */
const warnIfEmailNotVerified = (req, res, next) => {
  if (req.user && !req.user.isEmailVerified) {
    console.warn(
      `[EmailVerification] Unverified user ${req.user._id} (${req.user.email}) attempted: ${req.method} ${req.originalUrl}`,
    );
  }
  next();
};

module.exports = {
  emailVerificationRequired,
  warnIfEmailNotVerified,
};

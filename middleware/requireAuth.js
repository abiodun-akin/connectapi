const jwt = require("jsonwebtoken");
const User = require("../user");
const {
  AuthenticationError,
  AuthorizationError,
} = require("../errors/AppError");

const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1] || req.cookies.jwt;

  console.log("Auth header:", authHeader ? "Present" : "Missing");
  console.log("Cookie jwt:", req.cookies.jwt ? "Present" : "Missing");

  if (!token) {
    return next(new AuthenticationError("No authentication token provided"));
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(
      token,
      process.env.TOKEN_SECRET || "fallback-secret-for-dev-only",
    );
  } catch (err) {
    console.log("JWT verification error:", err.message);

    if (err.name === "TokenExpiredError") {
      return next(
        new AuthorizationError("Token has expired. Please login again."),
      );
    }

    return next(new AuthenticationError("Invalid authentication token"));
  }

  try {
    const user = await User.findById(decodedToken.id).select(
      "email isAdmin isSuspended suspensionReason isEmailVerified",
    );

    if (!user) {
      return next(new AuthenticationError("User not found"));
    }

    if (user.isSuspended) {
      return next(new AuthorizationError("Account suspended"));
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = requireAuth;

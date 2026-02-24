const jwt = require("jsonwebtoken");
const { AuthenticationError, AuthorizationError } = require("../errors/AppError");

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1] || req.cookies.jwt;

  console.log("Auth header:", authHeader ? "Present" : "Missing");
  console.log("Cookie jwt:", req.cookies.jwt ? "Present" : "Missing");

  if (!token) {
    return next(new AuthenticationError("No authentication token provided"));
  }

  jwt.verify(token, process.env.TOKEN_SECRET || "fallback-secret-for-dev-only", (err, decodedToken) => {
    if (err) {
      console.log("JWT verification error:", err.message);
      
      if (err.name === "TokenExpiredError") {
        return next(new AuthorizationError("Token has expired. Please login again."));
      }
      
      return next(new AuthenticationError("Invalid authentication token"));
    }

    req.user = decodedToken;
    next();
  });
};

module.exports = requireAuth;

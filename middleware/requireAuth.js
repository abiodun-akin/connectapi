const jwt = require("jsonwebtoken");

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1] || req.cookies.jwt;

  console.log(authHeader);

  if (!token) {
    return res.status(401).json({ error: "No token found" });
  }

  jwt.verify(token, process.env.TOKEN_SECRET, (err, decodedToken) => {
    if (err) {
      console.log(err.message);
      return res.status(403).json({ error: "Invalid or expired token" });
    }

    req.user = decodedToken;
    next();
  });
};

module.exports = requireAuth;

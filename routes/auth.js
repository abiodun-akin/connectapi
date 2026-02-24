const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../user");
const { publishEvent } = require("../middleware/eventNotification");
const { validateRequest, createValidationSchema } = require("../validators/inputValidator");
const { AuthenticationError, ConflictError } = require("../errors/AppError");

console.log("In auth routes");

// Validation schemas
const signupSchema = createValidationSchema("name", "email", "password");
const loginSchema = createValidationSchema("email", "password");

router.post("/signup", validateRequest(signupSchema), async (req, res, next) => {
  const { name, email, password } = req.body;

  try {
    const user = await User.signup({ name, email, password });
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
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    publishEvent("auth_events", "auth.signup", {
      userId: user._id,
      email: user.email,
      name: user.name,
    });

    res.status(201).json({
      message: "User created successfully",
      user: { id: user._id, email: user.email },
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
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    publishEvent("auth_events", "auth.login", {
      userId: user._id,
      email: user.email,
    });

    res.json({
      message: "Login successful",
      user: { id: user._id, email: user.email },
      token,
    });
  } catch (error) {
    next(new AuthenticationError("Invalid email or password"));
  }
});

router.post("/logout", (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: "strict",
  });

  publishEvent("auth_events", "auth.logout", { timestamp: new Date() });

  res.json({ message: "Logged out successfully" });
});

module.exports = router;

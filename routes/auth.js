const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const User = require("../user");

console.log("In auth routes");

router.post("/signup", async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) {
    return res
      .status(400)
      .json({ error: "Name, email and password are required" });
  }

  try {
    const user = await User.signup({ name, email, password });

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

    res.status(201).json({
      message: "User created successfully",
      user: { id: user._id, email: user.email },
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await User.login({ email, password });

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

    res.json({
      message: "Login successful",
      user: { id: user._id, email: user.email },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(401).json({ error: "Invalid email or password" });
  }
});

router.post("/logout", (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    maxAge: 0,
    sameSite: "strict",
  });

  res.json({ message: "Logged out successfully" });
});

module.exports = router;

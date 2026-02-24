require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const cors = require("cors");

const userRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const profileRoutes = require("./routes/profile");
const matchesRoutes = require("./routes/matches");
const messagesRoutes = require("./routes/messages");
const adminRoutes = require("./routes/admin");
const cronRoutes = require("./routes/cron");
const requireAuth = require("./middleware/requireAuth");
const getreport = require("./middleware/getreport");
const errorHandler = require("./middleware/errorHandler");
const {
  initializeRabbitMQ,
  eventNotificationMiddleware,
} = require("./middleware/eventNotification");

const Report = require("./report");
const { validateRequest, createValidationSchema } = require("./validators/inputValidator");
const { NotFoundError, ValidationError } = require("./errors/AppError");

const app = express();
const PORT = process.env.PORT || 8888;

// Security middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    sameSite: "none",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(eventNotificationMiddleware);

// Validation schemas for reports
const createReportSchema = createValidationSchema("title", "location", "description");
const updateReportSchema = createValidationSchema("title", "location", "description");

// Auth routes (no auth required)
app.use("/api/auth", userRoutes);

// Cron routes (Protected by secret)
app.use("/api/cron", cronRoutes);

// Payment routes (require authentication)
app.use("/api/payment", requireAuth, paymentRoutes);

// Profile routes (require authentication)
app.use("/api/profile", requireAuth, profileRoutes);

// Matches routes (require authentication)
app.use("/api/matches", requireAuth, matchesRoutes);

// Messages routes (require authentication)
app.use("/api/messages", requireAuth, messagesRoutes);

// Admin routes (require authentication and admin status)
app.use("/api/admin", requireAuth, adminRoutes);

// Report routes (require authentication)
app.use(requireAuth);

app.get("/api", async (req, res, next) => {
  try {
    const reports = await Report.find();
    console.log("Current user:", req.user);
    res.json(reports.length ? reports : []);
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/report",
  validateRequest(createReportSchema),
  async (req, res, next) => {
    const { title, location, desc } = req.body;

    try {
      const report = await Report.create({
        title,
        location,
        desc,
        user_id: req.user._id,
      });
      res.status(201).json(report);
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/report/:id", getreport, (req, res) => {
  res.json(req.report);
});

app.put(
  "/api/report/:id",
  getreport,
  validateRequest(updateReportSchema),
  async (req, res, next) => {
    const { title, location, desc } = req.body;

    try {
      const updated = await Report.findByIdAndUpdate(
        req.params.id,
        { title, location, desc },
        { new: true, runValidators: true }
      );

      if (!updated) {
        return next(new NotFoundError("Report"));
      }
      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

app.delete("/api/report/:id", getreport, async (req, res, next) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted successfully" });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found", code: "NOT_FOUND" });
});

// Error handling middleware (must be last)
app.use(errorHandler);

const startServer = async () => {
  try {
    await initializeRabbitMQ();

    await mongoose.connect(process.env.CONN_STR, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("MongoDB connected successfully");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();

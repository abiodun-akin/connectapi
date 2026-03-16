require("dotenv").config();
const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const userRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const profileRoutes = require("./routes/profile");
const matchesRoutes = require("./routes/matches");
const messagesRoutes = require("./routes/messages");
const adminRoutes = require("./routes/admin");
const adminAgentsRoutes = require("./routes/adminAgents");
const adminPaymentRoutes = require("./routes/adminPayment");
const agentsRoutes = require("./routes/agents");
const cronRoutes = require("./routes/cron");
const requireAuth = require("./middleware/requireAuth");
const getreport = require("./middleware/getreport");
const errorHandler = require("./middleware/errorHandler");
const Match = require("./match");
const Message = require("./message");
const { ensureSuperAdmin } = require("./utils/superAdminBootstrap");
const {
  initializeRabbitMQ,
  eventNotificationMiddleware,
} = require("./middleware/eventNotification");

const Report = require("./report");
const { validateRequest, createValidationSchema } = require("./validators/inputValidator");
const { NotFoundError, ValidationError } = require("./errors/AppError");

const app = express();
const PORT = process.env.PORT || 8888;

const normalizeOrigin = (value) => {
  if (!value) return "";
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  // Render host values are sometimes provided without protocol.
  return `https://${trimmed}`;
};

const getAllowedOrigins = () => {
  const configuredOrigins = [
    process.env.FRONTEND_ORIGINS,
    process.env.FRONTEND_ORIGIN,
  ]
    .filter(Boolean)
    .flatMap((value) => value.split(","))
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return [...new Set(configuredOrigins)];
  }

  return ["http://localhost:5173"];
};

const allowedOrigins = getAllowedOrigins();
const isOriginAllowed = (origin) => {
  // Allow non-browser requests (curl, server-to-server) without Origin header.
  if (!origin) return true;

  const normalizedRequestOrigin = normalizeOrigin(origin);
  return allowedOrigins.includes(normalizedRequestOrigin);
};

const corsOriginHandler = (origin, callback) => {
  return callback(null, isOriginAllowed(origin));
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOriginHandler,
    credentials: true,
  },
});

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
    origin: corsOriginHandler,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(eventNotificationMiddleware);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

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
app.use("/api/admin", requireAuth, adminPaymentRoutes);
app.use("/api/admin/agents", requireAuth, adminAgentsRoutes);

// Agent routes (require authentication)
app.use("/api/agents", requireAuth, agentsRoutes);

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

io.use((socket, next) => {
  try {
    const tokenFromAuth = socket.handshake.auth?.token;
    const authHeader = socket.handshake.headers?.authorization;
    const tokenFromHeader = authHeader?.split(" ")[1];
    const token = tokenFromAuth || tokenFromHeader;

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const decoded = jwt.verify(
      token,
      process.env.TOKEN_SECRET || "fallback-secret-for-dev-only"
    );
    socket.userId = decoded.id;
    return next();
  } catch (error) {
    return next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  socket.on("join-conversation", async ({ matchId }) => {
    try {
      if (!matchId) return;
      const match = await Match.findById(matchId);
      if (!match) return;

      const isParticipant =
        match.farmer_id.toString() === socket.userId ||
        match.vendor_id.toString() === socket.userId;

      if (!isParticipant) return;
      socket.join(`match:${matchId}`);
    } catch (error) {
      console.error("join-conversation error:", error.message);
    }
  });

  socket.on("leave-conversation", ({ matchId }) => {
    if (!matchId) return;
    socket.leave(`match:${matchId}`);
  });

  socket.on("send-message", async ({ matchId, content }) => {
    try {
      if (!matchId || !content || !content.trim()) return;

      const match = await Match.findById(matchId);
      if (!match) return;

      const isParticipant =
        match.farmer_id.toString() === socket.userId ||
        match.vendor_id.toString() === socket.userId;

      if (!isParticipant) return;
      if (!["interested", "connected"].includes(match.status)) return;

      const recipient_id =
        match.farmer_id.toString() === socket.userId
          ? match.vendor_id
          : match.farmer_id;

      const message = await Message.sendMessage({
        sender_id: socket.userId,
        recipient_id,
        match_id: matchId,
        content: content.trim(),
      });

      io.to(`match:${matchId}`).emit("new-message", {
        _id: message._id,
        match_id: message.match_id,
        sender_id: message.sender_id,
        recipient_id: message.recipient_id,
        content: message.content,
        status: message.status,
        createdAt: message.createdAt,
      });
    } catch (error) {
      console.error("send-message error:", error.message);
    }
  });
});

const startServer = async () => {
  try {
    await initializeRabbitMQ();

    await mongoose.connect(process.env.CONN_STR, {
        dbName: process.env.DB_NAME || undefined,
      });
    console.log("MongoDB connected successfully");

    await ensureSuperAdmin();

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();

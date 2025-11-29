require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const cors = require("cors");

const userRoutes = require("./routes/auth");
const paymentRoutes = require("./routes/payment");
const requireAuth = require("./middleware/requireAuth");
const getreport = require("./middleware/getreport");
const {
  initializeRabbitMQ,
  eventNotificationMiddleware,
} = require("./middleware/eventNotification");

const Report = require("./report");

const app = express();
const PORT = process.env.PORT || 8888;

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    sameSite: "none",
    credentials: true,
  })
);

app.use(eventNotificationMiddleware);

app.use("/api/auth", userRoutes);
app.use("/api/payment", paymentRoutes);

app.use(requireAuth);

app.get("/api", async (req, res) => {
  try {
    const reports = await Report.find();
    console.log("Current user:", req.user);
    res.json(reports.length ? reports : []);
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/report", async (req, res) => {
  const { title, location, desc } = req.body || {};

  if (!title || !location || !desc) {
    return res
      .status(400)
      .json({ error: "Title, location and description are required" });
  }

  try {
    const report = await Report.create({
      title,
      location,
      desc,
      user_id: req.user._id,
    });
    res.status(201).json(report);
  } catch (error) {
    console.error("Create report error:", error);
    res.status(500).json({ error: "Failed to create report" });
  }
});

app.get("/api/report/:id", getreport, (req, res) => {
  res.json(req.report);
});

app.put("/api/report/:id", getreport, async (req, res) => {
  const { title, location, desc } = req.body || {};

  if (!title || !location || !desc) {
    return res.status(400).json({ error: "All fields are required" });
  }

  try {
    const updated = await Report.findByIdAndUpdate(
      req.params.id,
      { title, location, desc },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: "Report not found" });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Update failed" });
  }
});

app.delete("/api/report/:id", getreport, async (req, res) => {
  try {
    await Report.findByIdAndDelete(req.params.id);
    res.json({ message: "Report deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Delete failed" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

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

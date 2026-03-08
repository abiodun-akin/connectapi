const mongoose = require("mongoose");

const agentApplicationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    motivation: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1500,
    },
    contactPhone: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
      index: true,
    },
    adminNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1500,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AgentApplication", agentApplicationSchema);

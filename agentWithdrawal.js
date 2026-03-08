const mongoose = require("mongoose");

const agentWithdrawalSchema = new mongoose.Schema(
  {
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "declined", "paid"],
      default: "pending",
      index: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    adminNote: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1500,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AgentWithdrawal", agentWithdrawalSchema);

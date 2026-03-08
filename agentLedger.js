const mongoose = require("mongoose");

const agentLedgerSchema = new mongoose.Schema(
  {
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recruit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    promoCode_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PromoCode",
      required: true,
    },
    promoCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    source: {
      type: String,
      enum: ["signup", "subscription-renewal"],
      default: "signup",
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["accrued", "reversed", "paid"],
      default: "accrued",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AgentLedger", agentLedgerSchema);

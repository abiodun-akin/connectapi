const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    agent_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    rebateType: {
      type: String,
      enum: ["fixed", "percentage"],
      default: "fixed",
    },
    rebateValue: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    maxRedemptions: {
      type: Number,
      default: null,
    },
    redemptionCount: {
      type: Number,
      default: 0,
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validTo: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

promoCodeSchema.statics.getRedeemableCode = async function (rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  const now = new Date();

  return this.findOne({
    code,
    status: "active",
    validFrom: { $lte: now },
    $or: [{ validTo: null }, { validTo: { $gte: now } }],
    $expr: {
      $or: [{ $eq: ["$maxRedemptions", null] }, { $lt: ["$redemptionCount", "$maxRedemptions"] }],
    },
  });
};

module.exports = mongoose.model("PromoCode", promoCodeSchema);

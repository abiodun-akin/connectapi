const mongoose = require("mongoose");

const paymentRecordSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    subscription_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
    },
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ["basic", "premium", "enterprise"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "NGN",
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed", "verified", "refunded", "disputed"],
      default: "pending",
      index: true,
    },
    paymentMethod: {
      type: String,
      default: "paystack",
    },
    paystackResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    email: {
      type: String,
      required: true,
    },
    // Paystack transaction details
    paystackTransactionId: {
      type: Number,
    },
    authorizationUrl: {
      type: String,
    },
    accessCode: {
      type: String,
    },
    payerEmail: {
      type: String,
    },
    payerPhone: {
      type: String,
    },
    // Payment verification
    verifiedAt: {
      type: Date,
    },
    verificationAttempts: {
      type: Number,
      default: 0,
    },
    verificationErrors: [{
      timestamp: Date,
      error: String,
    }],
    // Refund tracking
    refundStatus: {
      type: String,
      enum: ["none", "pending", "completed", "failed"],
      default: "none",
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    refundReference: {
      type: String,
    },
    refundInitiatedAt: {
      type: Date,
    },
    refundCompletedAt: {
      type: Date,
    },
    refundReason: {
      type: String,
    },
    // Dispute tracking
    disputeStatus: {
      type: String,
    },
    disputeReason: {
      type: String,
    },
    disputeEvidence: {
      type: String,
    },
    // Webhook tracking
    webhookReceived: {
      type: Boolean,
      default: false,
    },
    webhookReceivedAt: {
      type: Date,
    },
    webhookRetries: {
      type: Number,
      default: 0,
    },
    // Description for dashboard
    description: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Static methods
paymentRecordSchema.statics.createPaymentRecord = async function (paymentData) {
  const { 
    user_id, 
    reference, 
    plan, 
    amount, 
    email,
    paystackTransactionId,
    authorizationUrl,
    accessCode,
    description
  } = paymentData;

  return this.create({
    user_id,
    reference,
    plan,
    amount,
    email,
    status: "pending",
    paystackTransactionId,
    authorizationUrl,
    accessCode,
    description,
  });
};

paymentRecordSchema.statics.updatePaymentStatus = async function (
  reference,
  status,
  paystackResponse = null,
  verificationData = {}
) {
  const updateData = {
    status,
    paystackResponse,
    verifiedAt: status === "verified" ? new Date() : undefined,
    paystackTransactionId: verificationData.id,
    payerEmail: verificationData.customer?.email,
    payerPhone: verificationData.customer?.phone,
  };

  // Remove undefined fields
  Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

  return this.findOneAndUpdate(
    { reference },
    {
      $set: updateData,
      $inc: { verificationAttempts: 1 }
    },
    { new: true }
  );
};

paymentRecordSchema.statics.getPaymentByReference = async function (reference) {
  return this.findOne({ reference }).populate("user_id", "email");
};

paymentRecordSchema.statics.initiateRefund = async function (
  paymentId,
  refundReason
) {
  return this.findByIdAndUpdate(
    paymentId,
    {
      refundStatus: "pending",
      refundReason,
      refundInitiatedAt: new Date(),
    },
    { new: true }
  );
};

paymentRecordSchema.statics.completeRefund = async function (
  paymentId,
  refundReference
) {
  return this.findByIdAndUpdate(
    paymentId,
    {
      refundStatus: "completed",
      refundReference,
      refundCompletedAt: new Date(),
    },
    { new: true }
  );
};

paymentRecordSchema.statics.recordVerificationError = async function (
  reference,
  error
) {
  return this.findOneAndUpdate(
    { reference },
    {
      $push: {
        verificationErrors: {
          timestamp: new Date(),
          error: error.message,
        }
      }
    },
    { new: true }
  );
};

paymentRecordSchema.statics.getPaymentsByStatus = async function (status, limit = 20, skip = 0) {
  return this.find({ status })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip)
    .populate("user_id", "email");
};

paymentRecordSchema.statics.getPaymentStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: "$amount" }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
};

const PaymentRecord = mongoose.model("PaymentRecord", paymentRecordSchema);
module.exports = PaymentRecord;

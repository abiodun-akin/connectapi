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
      enum: ["pending", "success", "failed", "verified"],
      default: "pending",
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
  },
  {
    timestamps: true,
  }
);

// Static methods
paymentRecordSchema.statics.createPaymentRecord = async function (paymentData) {
  const { user_id, reference, plan, amount, email } = paymentData;

  return this.create({
    user_id,
    reference,
    plan,
    amount,
    email,
    status: "pending",
  });
};

paymentRecordSchema.statics.updatePaymentStatus = async function (
  reference,
  status,
  paystackResponse = null
) {
  return this.findOneAndUpdate(
    { reference },
    {
      status,
      paystackResponse,
    },
    { new: true }
  );
};

paymentRecordSchema.statics.getPaymentByReference = async function (reference) {
  return this.findOne({ reference });
};

const PaymentRecord = mongoose.model("PaymentRecord", paymentRecordSchema);
module.exports = PaymentRecord;

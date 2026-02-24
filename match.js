const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema(
  {
    farmer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    matchScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    reason: String, // Why they were matched
    status: {
      type: String,
      enum: ["potential", "interested", "connected", "archived"],
      default: "potential",
    },
    initiatedBy: {
      type: String,
      enum: ["farmer", "vendor"],
    },
    dateInterestShown: Date,
    farmingAreasMatch: [String],
    servicesMatch: [String],
    farmerActivityScore: Number, // Farmer's activity score
    vendorActivityScore: Number, // Vendor's activity score
  },
  {
    timestamps: true,
  }
);

matchSchema.index({ farmer_id: 1, vendor_id: 1 }, { unique: true });
matchSchema.index({ farmer_id: 1, matchScore: -1 });
matchSchema.index({ vendor_id: 1, matchScore: -1 });

// Static methods
matchSchema.statics.createMatch = async function (farmer_id, vendor_id, matchData) {
  try {
    return await this.create({
      farmer_id,
      vendor_id,
      ...matchData,
    });
  } catch (error) {
    if (error.code === 11000) {
      // Match already exists, update it
      return this.findOneAndUpdate(
        { farmer_id, vendor_id },
        matchData,
        { new: true }
      );
    }
    throw error;
  }
};

matchSchema.statics.getMatchesForUser = async function (userId, role) {
  const query =
    role === "farmer" ? { farmer_id: userId } : { vendor_id: userId };

  return this.find(query)
    .populate("farmer_id", "email")
    .populate("vendor_id", "email")
    .sort({ matchScore: -1 });
};

matchSchema.statics.updateMatchScore = async function (
  farmer_id,
  vendor_id,
  newScore
) {
  return this.findOneAndUpdate(
    { farmer_id, vendor_id },
    { matchScore: newScore },
    { new: true }
  );
};

const Match = mongoose.model("Match", matchSchema);
module.exports = Match;

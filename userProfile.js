const mongoose = require("mongoose");

const userProfileSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      unique: true,
    },
    profileType: {
      type: String,
      enum: ["farmer", "vendor", "pending"],
      default: "pending",
      required: true,
    },
    isProfileComplete: {
      type: Boolean,
      default: false,
    },

    // Common fields
    phone: String,
    country: {
      type: String,
      default: "Nigeria",
      trim: true,
      index: true,
    },
    location: String,
    state: String,
    lga: String, // Local Government Area (for Nigeria)
    latitude: String,
    longitude: String,
    bio: String,
    profileImageUrl: String,

    // Social Media Links
    socialMedia: {
      facebook: String,
      twitter: String,
      instagram: String,
      linkedin: String,
      youtube: String,
      whatsapp: String,
      website: String,
    },

    // Push Notification Tokens
    fcmTokens: [String], // Firebase Cloud Messaging tokens for push notifications

    // Farmer-specific fields
    farmerDetails: {
      farmingAreas: [String], // Dropdown: Crop farming, Livestock, Aquaculture, Mixed farming, etc.
      cropsProduced: [String], // Dropdown: Rice, Maize, Cassava, Cocoa, etc.
      animalsRaised: [String], // Dropdown: Cattle, Poultry, Goats, Pigs, Fish, etc.
      farmSize: String, // Dropdown: <1 acre, 1-5 acres, 5-10 acres, >10 acres
      yearsOfExperience: String, // Dropdown: <1 year, 1-3 years, 3-5 years, >5 years
      certifications: [String], // Dropdown: Organic, Fair Trade, etc.
      interests: [String], // Dropdown: Funding, Partnership, Market access, Technology, Training, etc.
      otherInterests: String, // Custom interests when "Other" is selected
      productionCapacity: String, // Dropdown: Low, Medium, High
      seekingCollaboration: Boolean,
      seekingFunding: Boolean,
      seekingPartnership: Boolean,
      additionalInfo: String,
    },

    // Vendor-specific fields
    vendorDetails: {
      businessType: [String], // Dropdown: Input supplier, Equipment provider, Service provider, Processor, etc.
      servicesOffered: [String], // Dropdown: Seeds, Fertilizer, Tools, Machinery hire, Training, etc.
      yearsInBusiness: String, // Dropdown: <1 year, 1-3 years, 3-5 years, >5 years
      certifications: [String], // Dropdown: ISO certified, Government registered, etc.
      interests: [String], // Dropdown: Farmer partnerships, Bulk supply, Equipment sales, Service contracts, etc.
      otherInterests: String, // Custom interests when "Other" is selected
      operatingAreas: [String], // States they operate in
      businessRegistration: String,
      businessLicense: String,
      offersCredit: Boolean,
      seekingFarmerPartners: Boolean,
      seekingBulkSupply: Boolean,
      additionalInfo: String,
    },
  },
  {
    timestamps: true,
  },
);

userProfileSchema.index({
  profileType: 1,
  country: 1,
  state: 1,
  isProfileComplete: 1,
});

// Static methods
userProfileSchema.statics.createUserProfile = async function (
  userId,
  profileType,
) {
  return this.create({
    user_id: userId,
    profileType,
  });
};

userProfileSchema.statics.updateFarmerProfile = async function (
  userId,
  farmerData,
) {
  return this.findOneAndUpdate(
    { user_id: userId },
    {
      profileType: "farmer",
      isProfileComplete: true,
      ...farmerData,
    },
    { new: true },
  );
};

userProfileSchema.statics.updateVendorProfile = async function (
  userId,
  vendorData,
) {
  return this.findOneAndUpdate(
    { user_id: userId },
    {
      profileType: "vendor",
      isProfileComplete: true,
      ...vendorData,
    },
    { new: true },
  );
};

userProfileSchema.statics.getUserProfile = async function (userId) {
  return this.findOne({ user_id: userId });
};

const UserProfile = mongoose.model("UserProfile", userProfileSchema);
module.exports = UserProfile;

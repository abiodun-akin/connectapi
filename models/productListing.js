const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    category: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 30,
      default: "",
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      trim: true,
      maxlength: 5,
      default: "NGN",
    },
    quantityAvailable: {
      type: Number,
      min: 0,
      default: 0,
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (images) => Array.isArray(images) && images.length <= 3,
        message: "A product can have at most 3 images",
      },
    },
    moderationStatus: {
      type: String,
      enum: ["enabled", "suspended", "disabled"],
      default: "enabled",
      index: true,
    },
    moderationReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false },
);

const productListingSchema = new mongoose.Schema(
  {
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    ownerProfileType: {
      type: String,
      enum: ["farmer", "vendor"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    titleNormalized: {
      type: String,
      trim: true,
      unique: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: "",
    },
    products: {
      type: [productSchema],
      default: [],
      validate: {
        validator: (products) => Array.isArray(products),
        message: "Products must be a valid list",
      },
    },
    visibilityStatus: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
    suspendedReason: {
      type: String,
      trim: true,
      default: "",
    },
    moderationStatus: {
      type: String,
      enum: ["enabled", "suspended", "disabled"],
      default: "enabled",
      index: true,
    },
    moderationReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

productListingSchema.index({ visibilityStatus: 1, updatedAt: -1 });

productListingSchema.pre("validate", function setTitleNormalized(next) {
  this.titleNormalized = String(this.title || "")
    .trim()
    .toLowerCase();
  next();
});

const ProductListing = mongoose.model("ProductListing", productListingSchema);

module.exports = ProductListing;

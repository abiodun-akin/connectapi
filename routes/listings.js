const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const {
  upload,
  uploadToCloudinary,
  deleteFromCloudinary,
} = require("../services/fileUploadService");

const router = express.Router();
const ProductListing = require("../models/productListing");
const Subscription = require("../subscription");
const UserProfile = require("../userProfile");
const Match = require("../match");
const AuditLog = require("../auditLog");
const { calculateTotalActivityScore } = require("../utils/activityScorer");
const requireAuth = require("../middleware/requireAuth");
const {
  emailVerificationRequired,
} = require("../middleware/emailVerificationRequired");
const { ValidationError, NotFoundError } = require("../errors/AppError");

const normalizeProducts = (
  products = [],
  { allowEmpty = false, existingProducts = [] } = {},
) => {
  if (!Array.isArray(products)) {
    throw new ValidationError("products must be an array", "products");
  }

  if (!allowEmpty && products.length === 0) {
    throw new ValidationError("At least one product is required", "products");
  }

  return products.map((product, index) => {
    const name = String(product?.name || "").trim();
    if (!name) {
      throw new ValidationError(
        `Product name is required at row ${index + 1}`,
        "products",
      );
    }

    const images = Array.isArray(product?.images)
      ? product.images.filter((image) => String(image || "").trim())
      : [];

    if (images.length > 3) {
      throw new ValidationError(
        `Product "${name}" can have at most 3 images`,
        "products",
      );
    }

    const existingProduct = Array.isArray(existingProducts)
      ? existingProducts[index]
      : null;

    return {
      name,
      description: String(product?.description || "").trim(),
      category: String(product?.category || "").trim(),
      unit: String(product?.unit || "").trim(),
      price: Number(product?.price) || 0,
      currency: String(product?.currency || "NGN")
        .trim()
        .toUpperCase(),
      quantityAvailable: Number(product?.quantityAvailable) || 0,
      images,
      moderationStatus:
        existingProduct?.moderationStatus === "suspended" ||
        existingProduct?.moderationStatus === "disabled"
          ? existingProduct.moderationStatus
          : "enabled",
      moderationReason:
        existingProduct?.moderationStatus === "suspended" ||
        existingProduct?.moderationStatus === "disabled"
          ? String(existingProduct?.moderationReason || "")
          : "",
    };
  });
};

const getOwnerDisplayName = (owner) => {
  if (!owner) return "User";
  const name = String(owner.name || "").trim();
  return name || owner.email || "User";
};

const getActivePremiumSubscription = async (userId) => {
  const subscription = await Subscription.getUserActiveSubscription(userId);
  if (!subscription) return null;
  if (subscription.plan !== "premium") return null;
  return subscription;
};

const requireActivePremium = async (req, res) => {
  const activePremium = await getActivePremiumSubscription(req.user._id);
  if (!activePremium) {
    res.status(403).json({
      error:
        "Only premium subscribers with active subscription can manage listings",
      code: "PREMIUM_REQUIRED",
    });
    return null;
  }

  return activePremium;
};

const parseCoordinate = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const isWithinSupportedRegion = (latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  // Primary marketplace coverage currently focuses on Africa.
  return (
    latitude >= -35 && latitude <= 38 && longitude >= -20 && longitude <= 55
  );
};

const buildLocationConfidence = (profile) => {
  const latitude = parseCoordinate(profile?.latitude);
  const longitude = parseCoordinate(profile?.longitude);
  const hasCoordinates =
    Number.isFinite(latitude) && Number.isFinite(longitude);
  const hasAddressText =
    !!String(profile?.location || "").trim() ||
    !!String(profile?.lga || "").trim() ||
    !!String(profile?.state || "").trim() ||
    !!String(profile?.country || "").trim();

  if (hasCoordinates && isWithinSupportedRegion(latitude, longitude)) {
    return {
      level: "high",
      code: "COORDINATES_VERIFIED",
      hasCoordinates: true,
      message:
        "Map pin is generated from seller coordinates in profile and is usually reliable.",
    };
  }

  if (hasCoordinates) {
    return {
      level: "low",
      code: "COORDINATES_OUTSIDE_REGION",
      hasCoordinates: true,
      message:
        "Coordinates appear outside supported coverage and may be inaccurate. Confirm location in chat.",
    };
  }

  if (hasAddressText) {
    return {
      level: "medium",
      code: "TEXT_LOCATION_ONLY",
      hasCoordinates: false,
      message:
        "Map is estimated from text location details and may be approximate.",
    };
  }

  return {
    level: "low",
    code: "LOCATION_UNAVAILABLE",
    hasCoordinates: false,
    message:
      "Seller has not provided enough location details. Confirm pickup or delivery point in chat.",
  };
};

router.post(
  "/uploads/images",
  requireAuth,
  emailVerificationRequired,
  async (req, res, next) => {
    try {
      const activePremium = await requireActivePremium(req, res);
      if (!activePremium) return undefined;

      upload.array("images", 3)(req, res, async (uploadError) => {
        try {
          if (uploadError) {
            if (uploadError instanceof ValidationError) {
              return res.status(400).json({
                error: uploadError.message,
                code: uploadError.code,
                field: uploadError.field,
              });
            }

            if (uploadError.code === "LIMIT_FILE_SIZE") {
              return res.status(400).json({
                error: "Each image must be 3MB or less",
                code: "FILE_TOO_LARGE",
              });
            }

            if (uploadError.code === "LIMIT_FILE_COUNT") {
              return res.status(400).json({
                error: "You can upload at most 3 images at a time",
                code: "TOO_MANY_FILES",
              });
            }

            return next(uploadError);
          }

          const files = req.files || [];
          if (files.length === 0) {
            return res.status(400).json({
              error: "At least one image is required",
              code: "VALIDATION_ERROR",
            });
          }

          const storedFiles = await Promise.all(
            files.map(async (file) => {
              const result = await uploadToCloudinary(
                file.buffer,
                "farmconnect/listings",
                {
                  public_id: `listing_${Date.now()}_${Math.random().toString(36).substring(2)}`,
                  resource_type: "image",
                },
              );

              return {
                url: result.url,
                publicId: result.public_id,
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                format: result.format,
              };
            }),
          );

          return res.status(201).json({
            message: "Images uploaded successfully",
            files: storedFiles,
          });

          // Log audit event
          await AuditLog.logAction({
            userId: req.user._id,
            action: "FILE_UPLOAD",
            resource: "FILE",
            details: {
              fileCount: storedFiles.length,
              totalSize: storedFiles.reduce((sum, file) => sum + file.size, 0),
              ipAddress: req.ip,
              userAgent: req.get("User-Agent"),
            },
            ipAddress: req.ip,
            userAgent: req.get("User-Agent"),
          });
        } catch (error) {
          return next(error);
        }
      });

      // Log audit event - MOVED INSIDE THE CALLBACK ABOVE
    } catch (error) {
      next(error);
    }
  },
);

const enrichListingForPublic = async (listing) => {
  const [owner, ownerProfile, ownerScore, activePremium] = await Promise.all([
    require("../user").findById(listing.owner_id).select("name email"),
    UserProfile.findOne({ user_id: listing.owner_id }),
    calculateTotalActivityScore(listing.owner_id),
    getActivePremiumSubscription(listing.owner_id),
  ]);

  const hasActivePremium = !!activePremium;
  const locationConfidence = buildLocationConfidence(ownerProfile);

  return {
    _id: listing._id,
    title: listing.title,
    description: listing.description,
    owner: {
      _id: listing.owner_id,
      name: getOwnerDisplayName(owner),
      email: owner?.email || "",
      profileType: listing.ownerProfileType,
    },
    products: (listing.products || []).filter(
      (product) => (product?.moderationStatus || "enabled") === "enabled",
    ),
    featured: hasActivePremium,
    ownerPerformanceScore: ownerScore,
    location: {
      country: ownerProfile?.country || "",
      state: ownerProfile?.state || "",
      lga: ownerProfile?.lga || "",
      location: ownerProfile?.location || "",
      latitude: ownerProfile?.latitude || "",
      longitude: ownerProfile?.longitude || "",
      locationConfidence,
    },
    updatedAt: listing.updatedAt,
  };
};

router.get("/public", async (req, res, next) => {
  try {
    const listings = await ProductListing.find({
      visibilityStatus: "active",
      moderationStatus: "enabled",
    })
      .sort({ updatedAt: -1 })
      .lean();

    const enriched = await Promise.all(
      listings.map((listing) => enrichListingForPublic(listing)),
    );

    // Hide listings for users without active premium subscription.
    const visibleListings = enriched.filter((listing) => listing.featured);
    const moderatedVisibleListings = visibleListings.filter(
      (listing) =>
        Array.isArray(listing.products) && listing.products.length > 0,
    );

    moderatedVisibleListings.sort((a, b) => {
      if (b.ownerPerformanceScore !== a.ownerPerformanceScore) {
        return b.ownerPerformanceScore - a.ownerPerformanceScore;
      }
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.json({
      listings: moderatedVisibleListings,
      total: moderatedVisibleListings.length,
    });
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth);

router.get("/mine", async (req, res, next) => {
  try {
    const listing = await ProductListing.findOne({
      owner_id: req.user._id,
    }).lean();
    if (!listing) {
      return res.json({ listing: null });
    }

    const activePremium = await getActivePremiumSubscription(req.user._id);
    const profile = await UserProfile.findOne({ user_id: req.user._id }).lean();

    const visibilityStatus = activePremium ? "active" : "suspended";
    const suspendedReason = activePremium
      ? ""
      : "Active premium subscription required for public visibility";

    if (
      listing.visibilityStatus !== visibilityStatus ||
      (listing.suspendedReason || "") !== suspendedReason
    ) {
      await ProductListing.updateOne(
        { _id: listing._id },
        { visibilityStatus, suspendedReason },
      );
      listing.visibilityStatus = visibilityStatus;
      listing.suspendedReason = suspendedReason;
    }

    res.json({
      listing: {
        ...listing,
        isFeatured: !!activePremium,
        location: {
          country: profile?.country || "",
          state: profile?.state || "",
          lga: profile?.lga || "",
          location: profile?.location || "",
          latitude: profile?.latitude || "",
          longitude: profile?.longitude || "",
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", emailVerificationRequired, async (req, res, next) => {
  try {
    const existing = await ProductListing.findOne({ owner_id: req.user._id });
    if (existing) {
      return res.status(409).json({
        error: "You can only create one listing",
        code: "LISTING_EXISTS",
      });
    }

    const profile = await UserProfile.findOne({ user_id: req.user._id }).lean();
    if (!profile || !profile.isProfileComplete) {
      throw new ValidationError(
        "Complete your profile before creating a listing",
        "profile",
      );
    }

    if (!["farmer", "vendor"].includes(profile.profileType)) {
      throw new ValidationError(
        "Only farmers or vendors can create listings",
        "profileType",
      );
    }

    const activePremium = await getActivePremiumSubscription(req.user._id);
    if (!activePremium) {
      return res.status(403).json({
        error:
          "Only premium subscribers with active subscription can create listings",
        code: "PREMIUM_REQUIRED",
      });
    }

    const title = String(req.body?.title || "").trim();
    if (!title) {
      throw new ValidationError("title is required", "title");
    }

    const titleNormalized = title.toLowerCase();
    const titleConflict = await ProductListing.findOne({ titleNormalized });
    if (titleConflict) {
      return res.status(409).json({
        error: "Listing title already exists. Choose a unique title.",
        code: "LISTING_TITLE_EXISTS",
      });
    }

    const listing = await ProductListing.create({
      owner_id: req.user._id,
      ownerProfileType: profile.profileType,
      title,
      titleNormalized,
      description: String(req.body?.description || "").trim(),
      products:
        typeof req.body?.products === "undefined"
          ? []
          : normalizeProducts(req.body?.products, { allowEmpty: true }),
      visibilityStatus: "active",
      suspendedReason: "",
      moderationStatus: "enabled",
      moderationReason: "",
    });

    res.status(201).json({
      message: "Listing created successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/:listingId", emailVerificationRequired, async (req, res, next) => {
  try {
    const listing = await ProductListing.findById(req.params.listingId);
    if (!listing) {
      return next(new NotFoundError("Product listing"));
    }

    if (listing.owner_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        error: "Not authorized to edit this listing",
        code: "UNAUTHORIZED",
      });
    }

    const updates = {};
    if (typeof req.body?.title !== "undefined") {
      const title = String(req.body.title || "").trim();
      if (!title) {
        throw new ValidationError("title cannot be empty", "title");
      }

      const titleNormalized = title.toLowerCase();
      const titleConflict = await ProductListing.findOne({
        titleNormalized,
        _id: { $ne: listing._id },
      });
      if (titleConflict) {
        return res.status(409).json({
          error: "Listing title already exists. Choose a unique title.",
          code: "LISTING_TITLE_EXISTS",
        });
      }

      updates.title = title;
      updates.titleNormalized = titleNormalized;
    }

    if (typeof req.body?.description !== "undefined") {
      updates.description = String(req.body.description || "").trim();
    }

    if (typeof req.body?.products !== "undefined") {
      updates.products = normalizeProducts(req.body.products, {
        allowEmpty: true,
        existingProducts: listing.products,
      });
    }

    const activePremium = await getActivePremiumSubscription(req.user._id);
    if (!activePremium) {
      return res.status(403).json({
        error:
          "Only premium subscribers with active subscription can manage listings",
        code: "PREMIUM_REQUIRED",
      });
    }

    updates.visibilityStatus = activePremium ? "active" : "suspended";
    updates.suspendedReason = activePremium
      ? ""
      : "Active premium subscription required for public visibility";

    Object.assign(listing, updates);
    await listing.save();

    res.json({
      message: "Listing updated successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
});

router.delete(
  "/:listingId",
  emailVerificationRequired,
  async (req, res, next) => {
    try {
      const listing = await ProductListing.findById(req.params.listingId);
      if (!listing) {
        return next(new NotFoundError("Product listing"));
      }

      if (listing.owner_id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          error: "Not authorized to delete this listing",
          code: "UNAUTHORIZED",
        });
      }

      await ProductListing.deleteOne({ _id: listing._id });

      res.json({ message: "Listing deleted successfully" });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/:listingId/message-context",
  emailVerificationRequired,
  async (req, res, next) => {
    try {
      const listing = await ProductListing.findById(req.params.listingId);
      if (!listing) {
        return next(new NotFoundError("Product listing"));
      }

      if (listing.owner_id.toString() === req.user._id.toString()) {
        return res.status(400).json({
          error: "You cannot message your own listing",
          code: "INVALID_TARGET",
        });
      }

      const [ownerProfile, requesterProfile] = await Promise.all([
        UserProfile.findOne({ user_id: listing.owner_id }).lean(),
        UserProfile.findOne({ user_id: req.user._id }).lean(),
      ]);

      if (!ownerProfile || !requesterProfile) {
        throw new ValidationError(
          "Both users must complete profile before messaging",
          "profile",
        );
      }

      const requesterId = req.user._id.toString();
      const ownerId = listing.owner_id.toString();
      const requesterComesFirst = requesterId.localeCompare(ownerId) < 0;
      const farmerId = requesterComesFirst ? req.user._id : listing.owner_id;
      const vendorId = requesterComesFirst ? listing.owner_id : req.user._id;

      let match = await Match.findOne({
        farmer_id: farmerId,
        vendor_id: vendorId,
      });

      if (!match) {
        match = await Match.create({
          farmer_id: farmerId,
          vendor_id: vendorId,
          reason: "Created from public listing contact",
          status: "interested",
          initiatedBy:
            requesterProfile.profileType === "farmer" ? "farmer" : "vendor",
          dateInterestShown: new Date(),
        });
      } else if (!["interested", "connected"].includes(match.status)) {
        match.status = "interested";
        match.dateInterestShown = new Date();
        await match.save();
      }

      res.json({
        matchId: match._id,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;

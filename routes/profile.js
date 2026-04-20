const express = require("express");
const router = express.Router();
const {
  emailVerificationRequired,
} = require("../middleware/emailVerificationRequired");
const UserProfile = require("../userProfile");
const Subscription = require("../subscription");
const { AFRICAN_COUNTRY_SET } = require("../utils/africanCountries");
const { ValidationError, NotFoundError } = require("../errors/AppError");
const { generateMatchesForProfile } = require("../utils/matchGenerator");

/**
 * POST /api/profile/initialize
 * Initialize user profile (choose farmer or vendor) - requires email verification
 */
router.post(
  "/initialize",
  emailVerificationRequired,
  async (req, res, next) => {
    const { profileType } = req.body;

    try {
      if (!["farmer", "vendor"].includes(profileType)) {
        throw new ValidationError(
          "Profile type must be farmer or vendor",
          "profileType",
        );
      }

      const existingProfile = await UserProfile.getUserProfile(req.user._id);

      // If profile is already complete, don't allow re-initialization
      if (existingProfile && existingProfile.isProfileComplete) {
        return res.status(400).json({
          error: "Profile already completed",
          code: "PROFILE_ALREADY_COMPLETE",
        });
      }

      let profile;

      // If profile exists but incomplete, update it
      if (existingProfile) {
        profile = await UserProfile.findOneAndUpdate(
          { user_id: req.user._id },
          { profileType },
          { new: true },
        );
      } else {
        // Create new profile
        profile = await UserProfile.create({
          user_id: req.user._id,
          profileType,
        });
      }

      res.json({
        message: "Profile type selected",
        profile,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/profile/farmer
 * Complete farmer profile - requires email verification
 */
router.post("/farmer", emailVerificationRequired, async (req, res, next) => {
  const farmerData = req.body;

  try {
    if (!farmerData.country || !AFRICAN_COUNTRY_SET.has(farmerData.country)) {
      throw new ValidationError(
        "Please select a valid African country",
        "country",
      );
    }

    // Validate top-level required fields
    if (!farmerData.phone) {
      throw new ValidationError("phone is required", "phone");
    }
    if (!farmerData.location) {
      throw new ValidationError("location is required", "location");
    }
    if (!farmerData.state) {
      throw new ValidationError("state is required", "state");
    }
    if (farmerData.country === "Nigeria" && !farmerData.lga) {
      throw new ValidationError("lga is required for Nigeria", "lga");
    }

    // Validate nested farmerDetails fields
    const requiredNestedFields = [
      "farmingAreas",
      "cropsProduced",
      "yearsOfExperience",
      "interests",
    ];

    for (const field of requiredNestedFields) {
      if (
        !farmerData.farmerDetails?.[field] ||
        (Array.isArray(farmerData.farmerDetails[field]) &&
          farmerData.farmerDetails[field].length === 0)
      ) {
        throw new ValidationError(`${field} is required`, field);
      }
    }

    const profile = await UserProfile.updateFarmerProfile(req.user._id, {
      phone: farmerData.phone,
      country: farmerData.country,
      location: farmerData.location,
      state: farmerData.state,
      lga: farmerData.lga,
      latitude: farmerData.latitude,
      longitude: farmerData.longitude,
      bio: farmerData.bio,
      profileImageUrl: farmerData.profileImageUrl,
      farmerDetails: farmerData.farmerDetails,
    });

    // Generate matches for this newly completed profile
    if (profile && profile.isProfileComplete) {
      generateMatchesForProfile(req.user._id, profile).catch((error) => {
        console.error("Error generating matches for farmer profile:", error);
      });
    }

    res.json({
      message: "Farmer profile completed successfully",
      profile,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/profile/vendor
 * Complete vendor profile - requires email verification
 */
router.post("/vendor", emailVerificationRequired, async (req, res, next) => {
  const vendorData = req.body;

  try {
    if (!vendorData.country || !AFRICAN_COUNTRY_SET.has(vendorData.country)) {
      throw new ValidationError(
        "Please select a valid African country",
        "country",
      );
    }

    // Validate top-level required fields
    if (!vendorData.phone) {
      throw new ValidationError("phone is required", "phone");
    }
    if (!vendorData.location) {
      throw new ValidationError("location is required", "location");
    }
    if (!vendorData.state) {
      throw new ValidationError("state is required", "state");
    }
    if (vendorData.country === "Nigeria" && !vendorData.lga) {
      throw new ValidationError("lga is required for Nigeria", "lga");
    }

    // Validate nested vendorDetails fields
    const requiredNestedFields = [
      "businessType",
      "servicesOffered",
      "yearsInBusiness",
      "interests",
    ];

    for (const field of requiredNestedFields) {
      if (
        !vendorData.vendorDetails?.[field] ||
        (Array.isArray(vendorData.vendorDetails[field]) &&
          vendorData.vendorDetails[field].length === 0)
      ) {
        throw new ValidationError(`${field} is required`, field);
      }
    }

    const profile = await UserProfile.updateVendorProfile(req.user._id, {
      phone: vendorData.phone,
      country: vendorData.country,
      location: vendorData.location,
      state: vendorData.state,
      lga: vendorData.lga,
      latitude: vendorData.latitude,
      longitude: vendorData.longitude,
      bio: vendorData.bio,
      profileImageUrl: vendorData.profileImageUrl,
      vendorDetails: vendorData.vendorDetails,
    });

    // Generate matches for this newly completed profile
    if (profile && profile.isProfileComplete) {
      generateMatchesForProfile(req.user._id, profile).catch((error) => {
        console.error("Error generating matches for vendor profile:", error);
      });
    }

    res.json({
      message: "Vendor profile completed successfully",
      profile,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile
 * Get current user's profile
 */
router.get("/", async (req, res, next) => {
  try {
    const profile = await UserProfile.getUserProfile(req.user._id);

    if (!profile) {
      return res.json({
        profile: null,
        isProfileComplete: false,
        message: "Profile not started",
      });
    }

    // Determine if profile completion is required
    const subscription = await Subscription.findOne({
      user_id: req.user._id,
      status: { $in: ["active", "trial"] },
    });

    res.json({
      profile,
      isProfileComplete: profile.isProfileComplete,
      requiresCompletion: subscription && !profile.isProfileComplete,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/profile/:userId
 * Get public profile of another user
 */
router.get("/:userId", async (req, res, next) => {
  try {
    const profile = await UserProfile.findOne({ user_id: req.params.userId });

    if (!profile) {
      return next(new NotFoundError("User profile"));
    }

    // Don't send sensitive data
    const publicProfile = {
      _id: profile._id,
      profileType: profile.profileType,
      country: profile.country,
      location: profile.location,
      state: profile.state,
      bio: profile.bio,
      profileImageUrl: profile.profileImageUrl,
      createdAt: profile.createdAt,
      ...(profile.profileType === "farmer" && {
        farmingAreas: profile.farmerDetails?.farmingAreas,
        cropsProduced: profile.farmerDetails?.cropsProduced,
        yearsOfExperience: profile.farmerDetails?.yearsOfExperience,
      }),
      ...(profile.profileType === "vendor" && {
        businessType: profile.vendorDetails?.businessType,
        servicesOffered: profile.vendorDetails?.servicesOffered,
      }),
    };

    res.json(publicProfile);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/profile
 * Update user profile (requires email verification)
 */
router.put("/", emailVerificationRequired, async (req, res, next) => {
  try {
    const profile = await UserProfile.findOneAndUpdate(
      { user_id: req.user._id },
      req.body,
      { new: true },
    );

    if (!profile) {
      return next(new NotFoundError("User profile"));
    }

    res.json({
      message: "Profile updated successfully",
      profile,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

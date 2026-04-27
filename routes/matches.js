const express = require("express");
const router = express.Router();
const Match = require("../match");
const Message = require("../message");
const UserProfile = require("../userProfile");
const { calculateTotalActivityScore } = require("../utils/activityScorer");
const { NotFoundError, ValidationError } = require("../errors/AppError");

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const getDistanceKm = (lat1, lon1, lat2, lon2) => {
  const aLat = Number(lat1);
  const aLon = Number(lon1);
  const bLat = Number(lat2);
  const bLon = Number(lon2);

  if ([aLat, aLon, bLat, bLon].some((value) => Number.isNaN(value))) {
    return null;
  }

  const earthRadiusKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const c1 = Math.sin(dLat / 2) * Math.sin(dLat / 2);
  const c2 =
    Math.cos(toRadians(aLat)) *
    Math.cos(toRadians(bLat)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(c1 + c2), Math.sqrt(1 - (c1 + c2)));
  return Math.round(earthRadiusKm * c);
};

const computeOverlapScore = (requesterProfile, matchedProfile) => {
  const requesterIsFarmer = requesterProfile.profileType === "farmer";
  const requesterItems = requesterIsFarmer
    ? requesterProfile.farmerDetails?.farmingAreas || []
    : requesterProfile.vendorDetails?.servicesOffered || [];
  const matchedItems = requesterIsFarmer
    ? matchedProfile.vendorDetails?.servicesOffered || []
    : matchedProfile.farmerDetails?.farmingAreas || [];

  if (!requesterItems.length || !matchedItems.length) {
    return 0;
  }

  const requesterSet = new Set(
    requesterItems.map((item) => String(item).toLowerCase()),
  );
  const matchedSet = new Set(
    matchedItems.map((item) => String(item).toLowerCase()),
  );
  let overlap = 0;
  requesterSet.forEach((item) => {
    if (matchedSet.has(item)) {
      overlap += 1;
    }
  });

  return Math.min(20, overlap * 5);
};

/**
 * GET /api/matches
 * Get matches for current user (farmers get vendor matches, vendors get farmer matches)
 */
router.get("/", async (req, res, next) => {
  const {
    status,
    limit = 10,
    page = 1,
    country,
    state,
    service,
    farmingArea,
    minScore,
    maxDistanceKm,
  } = req.query;

  try {
    const userProfile = await UserProfile.findOne({ user_id: req.user._id });

    if (!userProfile) {
      console.log(`[Matches] Profile not found for user ${req.user._id}`);
      return res.status(400).json({
        error: "Please complete your profile to view matches",
        code: "PROFILE_INCOMPLETE",
        detail: "profile_not_found",
      });
    }

    if (!userProfile.isProfileComplete) {
      console.log(
        `[Matches] Profile incomplete for user ${req.user._id}, profileType: ${userProfile.profileType}`,
      );
      return res.status(400).json({
        error: "Please complete your profile to view matches",
        code: "PROFILE_INCOMPLETE",
        detail: "profile_not_complete",
        profileType: userProfile.profileType,
      });
    }

    const query = {};
    const normalizedCountry = String(country || "").trim();
    const normalizedState = String(state || "").trim();
    const normalizedService = String(service || "").trim();
    const normalizedFarmingArea = String(farmingArea || "").trim();
    const minRecommendationScore = Number(minScore);
    const maxDistance = Number(maxDistanceKm);
    const targetProfileType =
      userProfile.profileType === "farmer" ? "vendor" : "farmer";
    const targetMatchField =
      userProfile.profileType === "farmer" ? "vendor_id" : "farmer_id";

    if (userProfile.profileType === "farmer") {
      query.farmer_id = req.user._id;
    } else if (userProfile.profileType === "vendor") {
      query.vendor_id = req.user._id;
    }

    // Reconcile stale statuses: if a match has message activity, it should be connected.
    const participantField =
      userProfile.profileType === "farmer" ? "farmer_id" : "vendor_id";
    const interestedMatches = await Match.find({
      [participantField]: req.user._id,
      status: "interested",
    })
      .select("_id")
      .lean();

    if (interestedMatches.length > 0) {
      const interestedIds = interestedMatches.map((item) => item._id);
      const activeConversationMatchIds = await Message.distinct("match_id", {
        match_id: { $in: interestedIds },
      });

      if (activeConversationMatchIds.length > 0) {
        await Match.updateMany(
          {
            _id: { $in: activeConversationMatchIds },
            status: "interested",
          },
          { $set: { status: "connected" } },
        );
      }
    }

    if (
      status &&
      ["potential", "interested", "connected", "archived"].includes(status)
    ) {
      query.status = status;
    } else {
      query.status = { $in: ["potential", "interested", "connected"] };
    }

    if (
      normalizedCountry ||
      normalizedState ||
      normalizedService ||
      normalizedFarmingArea
    ) {
      const profileFilter = {
        profileType: targetProfileType,
        isProfileComplete: true,
      };

      if (normalizedCountry) {
        profileFilter.country = normalizedCountry;
      }

      if (normalizedState) {
        profileFilter.state = { $regex: normalizedState, $options: "i" };
      }

      if (normalizedService) {
        profileFilter["vendorDetails.servicesOffered"] = {
          $regex: normalizedService,
          $options: "i",
        };
      }

      if (normalizedFarmingArea) {
        profileFilter["farmerDetails.farmingAreas"] = {
          $regex: normalizedFarmingArea,
          $options: "i",
        };
      }

      const profileUserIds =
        await UserProfile.find(profileFilter).distinct("user_id");

      if (profileUserIds.length === 0) {
        return res.json({
          matches: [],
          pagination: {
            total: 0,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            pages: 0,
          },
          appliedFilters: {
            country: normalizedCountry || null,
            state: normalizedState || null,
            service: normalizedService || null,
            farmingArea: normalizedFarmingArea || null,
            minScore: Number.isFinite(minRecommendationScore)
              ? minRecommendationScore
              : null,
            maxDistanceKm: Number.isFinite(maxDistance) ? maxDistance : null,
          },
        });
      }

      query[targetMatchField] = { $in: profileUserIds };
    }

    const skip = (page - 1) * limit;
    const matches = await Match.find(query)
      .sort({ matchScore: -1 })
      .populate({
        path: userProfile.profileType === "farmer" ? "vendor_id" : "farmer_id",
        select: "email",
      })
      .exec();

    const total = await Match.countDocuments(query);

    // Enrich matches with user profile data and penalty-aware scores
    const enrichedMatches = await Promise.all(
      matches.map(async (match) => {
        const matchedUserId =
          userProfile.profileType === "farmer"
            ? match.vendor_id._id
            : match.farmer_id._id;
        const matchedProfile = await UserProfile.findOne({
          user_id: matchedUserId,
        });

        const farmerScore = await calculateTotalActivityScore(match.farmer_id);
        const vendorScore = await calculateTotalActivityScore(match.vendor_id);
        const baseActivityScore = Math.round((farmerScore + vendorScore) / 2);
        const overlapScore = computeOverlapScore(
          userProfile,
          matchedProfile || {},
        );
        const distanceKm = getDistanceKm(
          userProfile.latitude,
          userProfile.longitude,
          matchedProfile?.latitude,
          matchedProfile?.longitude,
        );
        const distancePenalty = Number.isFinite(distanceKm)
          ? Math.min(20, Math.floor(distanceKm / 100))
          : 0;
        const computedMatchScore = Math.max(
          0,
          Math.min(100, baseActivityScore + overlapScore - distancePenalty),
        );

        return {
          _id: match._id,
          matchScore: computedMatchScore,
          status: match.status,
          initiatedBy: match.initiatedBy,
          dateInterestShown: match.dateInterestShown,
          reason: match.reason,
          activityScores: {
            farmer: farmerScore,
            vendor: vendorScore,
          },
          recommendationMeta: {
            baseActivityScore,
            overlapScore,
            distanceKm,
            distancePenalty,
          },
          userProfile: matchedProfile && {
            profileType: matchedProfile.profileType,
            country: matchedProfile.country,
            location: matchedProfile.location,
            state: matchedProfile.state,
            bio: matchedProfile.bio,
            ...(matchedProfile.profileType === "farmer" && {
              farmingAreas: matchedProfile.farmerDetails?.farmingAreas,
              cropsProduced: matchedProfile.farmerDetails?.cropsProduced,
            }),
            ...(matchedProfile.profileType === "vendor" && {
              businessType: matchedProfile.vendorDetails?.businessType,
              servicesOffered: matchedProfile.vendorDetails?.servicesOffered,
            }),
          },
        };
      }),
    );

    const filteredMatches = enrichedMatches.filter((matchItem) => {
      if (
        Number.isFinite(minRecommendationScore) &&
        matchItem.matchScore < minRecommendationScore
      ) {
        return false;
      }

      if (
        Number.isFinite(maxDistance) &&
        Number.isFinite(matchItem.recommendationMeta?.distanceKm) &&
        matchItem.recommendationMeta.distanceKm > maxDistance
      ) {
        return false;
      }

      return true;
    });

    filteredMatches.sort((a, b) => b.matchScore - a.matchScore);
    const pageLimit = parseInt(limit, 10);
    const pagedMatches = filteredMatches.slice(skip, skip + pageLimit);

    res.json({
      matches: pagedMatches,
      pagination: {
        total: filteredMatches.length,
        page: parseInt(page),
        limit: pageLimit,
        pages: Math.ceil(filteredMatches.length / pageLimit),
      },
      appliedFilters: {
        country: normalizedCountry || null,
        state: normalizedState || null,
        service: normalizedService || null,
        farmingArea: normalizedFarmingArea || null,
        minScore: Number.isFinite(minRecommendationScore)
          ? minRecommendationScore
          : null,
        maxDistanceKm: Number.isFinite(maxDistance) ? maxDistance : null,
      },
      queryTotal: total,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/matches/:matchId/express-interest
 * Express interest in a match
 */
router.post("/:matchId/express-interest", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user is part of this match
    if (
      match.farmer_id.toString() !== req.user._id.toString() &&
      match.vendor_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to update this match",
        code: "UNAUTHORIZED",
      });
    }

    // Determine which profile type is expressing interest
    const initiatingUserIsFarmer =
      match.farmer_id.toString() === req.user._id.toString();

    match.status = "interested";
    match.dateInterestShown = new Date();
    match.initiatedBy = initiatingUserIsFarmer ? "farmer" : "vendor";
    await match.save();

    res.json({
      message: "Interest expressed successfully",
      match,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/matches/:matchId/update-score
 * Update match score (called by user activity tracking)
 */
router.put("/:matchId/update-score", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    const farmerScore = await calculateTotalActivityScore(match.farmer_id);
    const vendorScore = await calculateTotalActivityScore(match.vendor_id);

    match.farmerActivityScore = farmerScore;
    match.vendorActivityScore = vendorScore;
    match.matchScore = Math.round((farmerScore + vendorScore) / 2);

    await match.save();

    res.json({
      message: "Match score updated",
      match,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/matches/create-from-interest
 * Admin endpoint: Create match from user interest (used by messaging flow)
 */
router.post("/create-from-interest", async (req, res, next) => {
  const { farmerId, vendorId, reason } = req.body;

  try {
    if (!farmerId || !vendorId) {
      throw new ValidationError(
        "Both farmerId and vendorId are required",
        "farmerId",
      );
    }

    const match = await Match.createMatch({
      farmer_id: farmerId,
      vendor_id: vendorId,
      reason: reason || "Interest expressed",
    });

    res.status(201).json({
      message: "Match created successfully",
      match,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/matches/:matchId
 * Get match details
 */
router.get("/:matchId", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate("farmer_id", "email")
      .populate("vendor_id", "email");

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user has access to this match
    if (
      match.farmer_id._id.toString() !== req.user._id.toString() &&
      match.vendor_id._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to view this match",
        code: "UNAUTHORIZED",
      });
    }

    res.json(match);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/matches/:matchId
 * Archive/delete match
 */
router.delete("/:matchId", async (req, res, next) => {
  try {
    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return next(new NotFoundError("Match"));
    }

    // Verify user is part of this match
    if (
      match.farmer_id.toString() !== req.user._id.toString() &&
      match.vendor_id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({
        error: "Not authorized to delete this match",
        code: "UNAUTHORIZED",
      });
    }

    match.status = "archived";
    await match.save();

    res.json({
      message: "Match archived successfully",
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

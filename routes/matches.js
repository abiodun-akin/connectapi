const express = require("express");
const router = express.Router();
const Match = require("../match");
const UserProfile = require("../userProfile");
const { calculateTotalActivityScore } = require("../utils/activityScorer");
const { NotFoundError, ValidationError } = require("../errors/AppError");

/**
 * GET /api/matches
 * Get matches for current user (farmers get vendor matches, vendors get farmer matches)
 */
router.get("/", async (req, res, next) => {
  const { status, limit = 10, page = 1 } = req.query;

  try {
    const userProfile = await UserProfile.findOne({ user_id: req.user._id });

    if (!userProfile || !userProfile.isProfileComplete) {
      return res.status(400).json({
        error: "Profile must be complete to view matches",
        code: "PROFILE_INCOMPLETE",
      });
    }

    let query = {};

    if (userProfile.profileType === "farmer") {
      query.farmer_id = req.user._id;
    } else if (userProfile.profileType === "vendor") {
      query.vendor_id = req.user._id;
    }

    if (status && ["potential", "interested", "connected", "archived"].includes(status)) {
      query.status = status;
    } else {
      query.status = { $in: ["potential", "interested", "connected"] };
    }

    const skip = (page - 1) * limit;
    const matches = await Match.find(query)
      .sort({ matchScore: -1 })
      .limit(parseInt(limit))
      .skip(skip)
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
          userProfile.profileType === "farmer" ? match.vendor_id._id : match.farmer_id._id;
        const matchedProfile = await UserProfile.findOne({ user_id: matchedUserId });

        const farmerScore = await calculateTotalActivityScore(match.farmer_id);
        const vendorScore = await calculateTotalActivityScore(match.vendor_id);
        const computedMatchScore = Math.round((farmerScore + vendorScore) / 2);

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
          userProfile: matchedProfile && {
            profileType: matchedProfile.profileType,
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
      })
    );

    enrichedMatches.sort((a, b) => b.matchScore - a.matchScore);

    res.json({
      matches: enrichedMatches,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
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
    if (match.farmer_id.toString() !== req.user._id.toString() &&
        match.vendor_id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        error: "Not authorized to update this match",
        code: "UNAUTHORIZED",
      });
    }

    match.status = "interested";
    match.dateInterestShown = new Date();
    match.initiatedBy = req.user._id;
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
      throw new ValidationError("Both farmerId and vendorId are required", "farmerId");
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
    if (match.farmer_id._id.toString() !== req.user._id.toString() &&
        match.vendor_id._id.toString() !== req.user._id.toString()) {
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
    if (match.farmer_id.toString() !== req.user._id.toString() &&
        match.vendor_id.toString() !== req.user._id.toString()) {
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

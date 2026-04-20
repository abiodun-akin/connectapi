/**
 * Match Generator Utility
 * Automatically generates matches when profiles are created or updated
 */

const Match = require("../match");
const UserProfile = require("../userProfile");

/**
 * Generate matches for a newly completed profile
 * @param {String} userId - User ID
 * @param {Object} userProfile - The user's profile object
 */
async function generateMatchesForProfile(userId, userProfile) {
  try {
    if (!userProfile || !userProfile.isProfileComplete) {
      console.log(
        `[matchGenerator] Profile not complete, skipping match generation for user ${userId}`,
      );
      return;
    }

    const targetProfileType =
      userProfile.profileType === "farmer" ? "vendor" : "farmer";

    // Find all potential matches with same country
    const potentialMatches = await UserProfile.find({
      profileType: targetProfileType,
      isProfileComplete: true,
      country: userProfile.country,
      user_id: { $ne: userId }, // Exclude self
    });

    console.log(
      `[matchGenerator] Found ${potentialMatches.length} potential ${targetProfileType} in ${userProfile.country} for user ${userId}`,
    );

    // Create match records for each potential match
    for (const otherProfile of potentialMatches) {
      try {
        const matchData = {
          ...(userProfile.profileType === "farmer" && {
            farmer_id: userId,
            vendor_id: otherProfile.user_id,
          }),
          ...(userProfile.profileType === "vendor" && {
            vendor_id: userId,
            farmer_id: otherProfile.user_id,
          }),
          status: "potential",
          matchScore: 50, // Default initial score
          reason: `Auto-matched based on location and profile type`,
        };

        // Create match (upsert - if exists, don't update)
        const match = await Match.create(matchData).catch((error) => {
          // If unique constraint error (match already exists), that's fine
          if (error.code === 11000) {
            console.log(
              `[matchGenerator] Match already exists for farmer/vendor pair`,
            );
            return null;
          }
          throw error;
        });

        if (match) {
          console.log(`[matchGenerator] Created match ${match._id}`);
        }
      } catch (error) {
        console.error(
          `[matchGenerator] Error creating match for profile pair:`,
          error.message,
        );
      }
    }

    console.log(
      `[matchGenerator] Completed match generation for user ${userId}`,
    );
  } catch (error) {
    console.error(`[matchGenerator] Error generating matches:`, error);
  }
}

module.exports = {
  generateMatchesForProfile,
};

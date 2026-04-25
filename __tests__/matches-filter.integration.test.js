const express = require("express");
const request = require("supertest");

jest.mock("../match", () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock("../userProfile", () => ({
  findOne: jest.fn(),
  find: jest.fn(),
}));

jest.mock("../utils/activityScorer", () => ({
  calculateTotalActivityScore: jest.fn(),
}));

const Match = require("../match");
const UserProfile = require("../userProfile");
const { calculateTotalActivityScore } = require("../utils/activityScorer");
const matchesRoutes = require("../routes/matches");
const errorHandler = require("../middleware/errorHandler");

describe("Matches country/state filter integration", () => {
  let app;

  const buildInterestedMatchesQuery = () => ({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  });

  const buildMainMatchesQuery = (docs) => ({
    sort: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(docs),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    Match.find.mockImplementation((query) => {
      if (query?.status === "interested") {
        return buildInterestedMatchesQuery();
      }
      return buildMainMatchesQuery([]);
    });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { _id: "507f1f77bcf86cd799439011" };
      next();
    });
    app.use("/api/matches", matchesRoutes);
    app.use(errorHandler);
  });

  it("returns empty result with applied filters when no profiles match country/state", async () => {
    UserProfile.findOne.mockResolvedValue({
      user_id: "507f1f77bcf86cd799439011",
      profileType: "farmer",
      isProfileComplete: true,
    });

    const distinct = jest.fn().mockResolvedValue([]);
    UserProfile.find.mockReturnValue({ distinct });

    const response = await request(app).get(
      "/api/matches?country=Kenya&state=Nairobi&page=1&limit=10",
    );

    expect(response.status).toBe(200);
    expect(UserProfile.find).toHaveBeenCalledWith({
      profileType: "vendor",
      isProfileComplete: true,
      country: "Kenya",
      state: { $regex: "Nairobi", $options: "i" },
    });
    expect(response.body.matches).toEqual([]);
    expect(response.body.appliedFilters).toEqual({
      country: "Kenya",
      state: "Nairobi",
      service: null,
      farmingArea: null,
      minScore: null,
      maxDistanceKm: null,
    });
    expect(response.body.pagination).toEqual({
      total: 0,
      page: 1,
      limit: 10,
      pages: 0,
    });
  });

  it("applies country/state filters and returns enriched matches", async () => {
    UserProfile.findOne
      .mockResolvedValueOnce({
        user_id: "507f1f77bcf86cd799439011",
        profileType: "farmer",
        isProfileComplete: true,
      })
      .mockResolvedValueOnce({
        profileType: "vendor",
        country: "Ghana",
        location: "Accra",
        state: "Greater Accra",
        bio: "Input supplier",
        vendorDetails: {
          businessType: ["Input Supplier (Seeds, Fertilizers, etc.)"],
          servicesOffered: ["Seeds", "Training"],
        },
      });

    const distinct = jest.fn().mockResolvedValue(["vendor-1"]);
    UserProfile.find.mockReturnValue({ distinct });

    const matchDocs = [
      {
        _id: "match-1",
        status: "interested",
        initiatedBy: "507f1f77bcf86cd799439011",
        dateInterestShown: new Date("2026-03-20T10:00:00.000Z"),
        reason: "Good overlap",
        farmer_id: "507f1f77bcf86cd799439011",
        vendor_id: { _id: "vendor-1", email: "vendor@example.com" },
      },
    ];

    Match.find.mockImplementation((query) => {
      if (query?.status === "interested") {
        return buildInterestedMatchesQuery();
      }
      return buildMainMatchesQuery(matchDocs);
    });
    Match.countDocuments.mockResolvedValue(1);
    calculateTotalActivityScore
      .mockResolvedValueOnce(78)
      .mockResolvedValueOnce(82);

    const response = await request(app).get(
      "/api/matches?country=Ghana&state=accra&page=1&limit=5",
    );

    expect(response.status).toBe(200);
    expect(Match.find).toHaveBeenCalledWith({
      farmer_id: "507f1f77bcf86cd799439011",
      status: { $in: ["potential", "interested", "connected"] },
      vendor_id: { $in: ["vendor-1"] },
    });
    expect(response.body.appliedFilters).toEqual({
      country: "Ghana",
      state: "accra",
      service: null,
      farmingArea: null,
      minScore: null,
      maxDistanceKm: null,
    });
    expect(response.body.pagination).toEqual({
      total: 1,
      page: 1,
      limit: 5,
      pages: 1,
    });
    expect(response.body.matches).toHaveLength(1);
    expect(response.body.matches[0]).toEqual(
      expect.objectContaining({
        _id: "match-1",
        matchScore: 80,
        userProfile: expect.objectContaining({
          profileType: "vendor",
          country: "Ghana",
          state: "Greater Accra",
        }),
      }),
    );
  });

  it("supports service filter and minimum score filtering", async () => {
    UserProfile.findOne
      .mockResolvedValueOnce({
        user_id: "507f1f77bcf86cd799439011",
        profileType: "farmer",
        isProfileComplete: true,
        latitude: "6.5244",
        longitude: "3.3792",
        farmerDetails: {
          farmingAreas: ["Crop farming"],
        },
      })
      .mockResolvedValueOnce({
        profileType: "vendor",
        latitude: "6.52",
        longitude: "3.37",
        vendorDetails: {
          servicesOffered: ["Seeds"],
        },
      })
      .mockResolvedValueOnce({
        profileType: "vendor",
        latitude: "51.5072",
        longitude: "0.1276",
        vendorDetails: {
          servicesOffered: ["Seeds"],
        },
      });

    const distinct = jest.fn().mockResolvedValue(["vendor-1", "vendor-2"]);
    UserProfile.find.mockReturnValue({ distinct });

    const matchDocs = [
      {
        _id: "match-1",
        status: "potential",
        initiatedBy: null,
        dateInterestShown: null,
        reason: "Good overlap",
        farmer_id: "507f1f77bcf86cd799439011",
        vendor_id: { _id: "vendor-1", email: "near@example.com" },
      },
      {
        _id: "match-2",
        status: "potential",
        initiatedBy: null,
        dateInterestShown: null,
        reason: "Far away",
        farmer_id: "507f1f77bcf86cd799439011",
        vendor_id: { _id: "vendor-2", email: "far@example.com" },
      },
    ];

    Match.find.mockImplementation((query) => {
      if (query?.status === "interested") {
        return buildInterestedMatchesQuery();
      }
      return buildMainMatchesQuery(matchDocs);
    });
    Match.countDocuments.mockResolvedValue(2);
    calculateTotalActivityScore
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(78)
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(70);

    const response = await request(app).get(
      "/api/matches?service=seed&minScore=75&maxDistanceKm=1000&page=1&limit=10",
    );

    expect(response.status).toBe(200);
    expect(UserProfile.find).toHaveBeenCalledWith({
      profileType: "vendor",
      isProfileComplete: true,
      "vendorDetails.servicesOffered": { $regex: "seed", $options: "i" },
    });
    expect(response.body.matches).toHaveLength(1);
    expect(response.body.matches[0]._id).toBe("match-1");
    expect(response.body.appliedFilters).toEqual({
      country: null,
      state: null,
      service: "seed",
      farmingArea: null,
      minScore: 75,
      maxDistanceKm: 1000,
    });
  });

  it("targets farmer profiles when requester is vendor", async () => {
    UserProfile.findOne.mockResolvedValue({
      user_id: "507f1f77bcf86cd799439011",
      profileType: "vendor",
      isProfileComplete: true,
    });

    const distinct = jest.fn().mockResolvedValue(["farmer-1", "farmer-2"]);
    UserProfile.find.mockReturnValue({ distinct });

    Match.find.mockImplementation((query) => {
      if (query?.status === "interested") {
        return buildInterestedMatchesQuery();
      }
      return buildMainMatchesQuery([]);
    });
    Match.countDocuments.mockResolvedValue(0);

    const response = await request(app).get(
      "/api/matches?country=Nigeria&state=Lagos",
    );

    expect(response.status).toBe(200);
    expect(UserProfile.find).toHaveBeenCalledWith({
      profileType: "farmer",
      isProfileComplete: true,
      country: "Nigeria",
      state: { $regex: "Lagos", $options: "i" },
    });
    expect(Match.find).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_id: "507f1f77bcf86cd799439011",
        farmer_id: { $in: ["farmer-1", "farmer-2"] },
      }),
    );
  });
});

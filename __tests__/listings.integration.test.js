const express = require("express");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const request = require("supertest");

process.env.LISTING_UPLOAD_DIR = path.join(
  os.tmpdir(),
  `farmconnect-listings-${Date.now()}`,
);

jest.mock("../middleware/requireAuth", () => (req, _res, next) => next());
jest.mock("../subscription", () => ({
  getUserActiveSubscription: jest.fn(),
  hasEverSubscribed: jest.fn(),
}));
jest.mock("../userProfile", () => ({
  findOne: jest.fn(),
}));
jest.mock("../user", () => ({
  findById: jest.fn(),
}));
jest.mock("../match", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));
jest.mock("../utils/activityScorer", () => ({
  calculateTotalActivityScore: jest.fn(),
}));
jest.mock("../models/productListing", () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  findById: jest.fn(),
  deleteOne: jest.fn(),
}));

const Subscription = require("../subscription");
const UserProfile = require("../userProfile");
const User = require("../user");
const Match = require("../match");
const { calculateTotalActivityScore } = require("../utils/activityScorer");
const ProductListing = require("../models/productListing");
const listingsRoutes = require("../routes/listings");
const errorHandler = require("../middleware/errorHandler");

const buildLeanableDoc = (doc) =>
  Object.assign(
    {
      lean: jest.fn().mockResolvedValue(doc),
    },
    doc,
  );

const buildSelectableDoc = (doc) =>
  Object.assign(
    {
      select: jest.fn().mockReturnValue(doc),
    },
    doc,
  );

describe("Listings routes", () => {
  let app;

  beforeEach(async () => {
    jest.clearAllMocks();
    await fs.rm(process.env.LISTING_UPLOAD_DIR, {
      recursive: true,
      force: true,
    });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = {
        _id: "requester-1",
        email: "requester@example.com",
        isEmailVerified: true,
      };
      next();
    });
    app.use("/api/listings", listingsRoutes);
    app.use(errorHandler);
  });

  afterAll(async () => {
    await fs.rm(process.env.LISTING_UPLOAD_DIR, {
      recursive: true,
      force: true,
    });
  });

  it("returns only active featured listings ranked by performance score", async () => {
    ProductListing.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            _id: "listing-1",
            owner_id: "owner-active",
            ownerProfileType: "vendor",
            title: "Active listing",
            description: "Active",
            products: [{ name: "Beans", images: [] }],
            visibilityStatus: "active",
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          },
          {
            _id: "listing-2",
            owner_id: "owner-expired",
            ownerProfileType: "vendor",
            title: "Expired listing",
            description: "Expired",
            products: [{ name: "Yam", images: [] }],
            visibilityStatus: "active",
            updatedAt: new Date("2026-02-01T00:00:00Z"),
          },
        ]),
      }),
    });
    User.findById.mockImplementation((userId) =>
      buildSelectableDoc({
        _id: userId,
        email: `${userId}@example.com`,
        name: userId === "owner-active" ? "Active Owner" : "Expired Owner",
      }),
    );
    UserProfile.findOne.mockImplementation(({ user_id: userId }) => {
      if (userId === "owner-active") {
        return buildLeanableDoc({
          profileType: "vendor",
          country: "Nigeria",
          state: "Lagos",
          lga: "Ikeja",
          location: "Ikeja",
          latitude: "6.6",
          longitude: "3.3",
        });
      }

      return buildLeanableDoc({
        profileType: "vendor",
        country: "Nigeria",
        state: "Abuja",
        lga: "FCT",
        location: "Wuse",
        latitude: "9.0",
        longitude: "7.4",
      });
    });
    Subscription.getUserActiveSubscription.mockImplementation((userId) =>
      Promise.resolve(
        userId === "owner-active"
          ? {
              _id: "sub-1",
              plan: "premium",
              endDate: new Date(Date.now() + 86400000),
            }
          : null,
      ),
    );
    calculateTotalActivityScore.mockImplementation((userId) =>
      Promise.resolve(userId === "owner-active" ? 88 : 20),
    );

    const response = await request(app).get("/api/listings/public");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.listings[0]).toEqual(
      expect.objectContaining({
        _id: "listing-1",
        featured: true,
        ownerPerformanceScore: 88,
      }),
    );
    expect(response.body.listings[0].location.locationConfidence).toEqual(
      expect.objectContaining({
        level: "high",
        code: "COORDINATES_VERIFIED",
        hasCoordinates: true,
      }),
    );
  });

  it("rejects listing creation when the user is not premium", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue(null);
    UserProfile.findOne.mockReturnValue(
      buildLeanableDoc({
        profileType: "vendor",
        isProfileComplete: true,
      }),
    );
    ProductListing.findOne.mockResolvedValue(null);

    const response = await request(app)
      .post("/api/listings")
      .send({
        title: "My listing",
        products: [{ name: "Beans", images: [] }],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("PREMIUM_REQUIRED");
  });

  it("uploads real listing images and returns stored URLs", async () => {
    Subscription.getUserActiveSubscription.mockResolvedValue({
      _id: "sub-1",
      plan: "premium",
      endDate: new Date(Date.now() + 86400000),
    });

    const response = await request(app)
      .post("/api/listings/uploads/images")
      .attach("images", Buffer.from("fake-image-data"), {
        filename: "produce.png",
        contentType: "image/png",
      });

    expect(response.status).toBe(201);
    expect(response.body.files).toHaveLength(1);
    expect(response.body.files[0].url).toMatch(/^\/uploads\/listings\//);

    const storedPath = path.join(
      process.env.LISTING_UPLOAD_DIR,
      path.basename(response.body.files[0].url),
    );
    const exists = await fs
      .access(storedPath)
      .then(() => true)
      .catch(() => false);

    expect(exists).toBe(true);
  });

  it("creates a message context for same-profile users instead of blocking", async () => {
    ProductListing.findById.mockResolvedValue({
      _id: "listing-1",
      owner_id: "owner-1",
    });
    UserProfile.findOne.mockImplementation(({ user_id: userId }) => {
      if (userId === "owner-1") {
        return buildLeanableDoc({ profileType: "vendor" });
      }

      return buildLeanableDoc({ profileType: "vendor" });
    });
    Match.findOne.mockResolvedValue(null);
    Match.create.mockResolvedValue({ _id: "match-1" });

    const response = await request(app)
      .post("/api/listings/listing-1/message-context")
      .send();

    expect(response.status).toBe(200);
    expect(response.body.matchId).toBe("match-1");
    expect(Match.create).toHaveBeenCalledWith(
      expect.objectContaining({
        farmer_id: "owner-1",
        vendor_id: "requester-1",
      }),
    );
  });
});

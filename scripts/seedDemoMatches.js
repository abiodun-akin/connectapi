require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../user");
const UserProfile = require("../userProfile");
const Match = require("../match");

const FARMER_EMAIL = (process.argv[2] || "abiodun.akinbodewa@gmail.com").trim().toLowerCase();

const demoVendors = [
  {
    name: "Amina Agro Supplies",
    email: "demo.vendor1@farmconnect.test",
    location: "Kano Municipal",
    state: "Kano",
    lga: "Kano Municipal",
    servicesOffered: ["Seeds", "Fertilizers", "Training"],
  },
  {
    name: "Kwame Farm Logistics",
    email: "demo.vendor2@farmconnect.test",
    location: "Accra",
    state: "Greater Accra",
    lga: "",
    servicesOffered: ["Transportation", "Storage Solutions", "Market Linkage"],
  },
  {
    name: "Nandi Mechanization Hub",
    email: "demo.vendor3@farmconnect.test",
    location: "Nairobi",
    state: "Nairobi County",
    lga: "",
    servicesOffered: ["Farm Equipment & Machinery", "Irrigation Systems", "Maintenance"],
  },
];

const createLocalUser = async ({ name, email, password }) => {
  const safeKey = String(email).toLowerCase().replace(/[^a-z0-9]/g, "");
  const hashedPassword = await bcrypt.hash(password, 12);

  return User.create({
    name,
    email,
    password: hashedPassword,
    isEmailVerified: true,
    googleId: `local-google-${safeKey}`,
    microsoftId: `local-ms-${safeKey}`,
  });
};

const ensureDemoVendor = async (vendor) => {
  let user = await User.findOne({ email: vendor.email });

  if (!user) {
    user = await createLocalUser({
      name: vendor.name,
      email: vendor.email,
      password: "DemoPass123",
    });
  }

  await UserProfile.findOneAndUpdate(
    { user_id: user._id },
    {
      user_id: user._id,
      profileType: "vendor",
      isProfileComplete: true,
      phone: "+2348000000000",
      country: vendor.state === "Kano" ? "Nigeria" : vendor.state === "Greater Accra" ? "Ghana" : "Kenya",
      location: vendor.location,
      state: vendor.state,
      lga: vendor.lga || undefined,
      bio: `${vendor.name} supports farmers with reliable services.`,
      vendorDetails: {
        businessType: ["Input Supplier (Seeds, Fertilizers, etc.)"],
        servicesOffered: vendor.servicesOffered,
        yearsInBusiness: "3-5 years",
        certifications: ["ISO 9001"],
        interests: ["Farmer Direct Partnerships"],
        operatingAreas: [vendor.state],
        businessRegistration: "DEMO-REG-001",
        offersCredit: true,
        additionalInfo: "Demo vendor account for local testing",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return user;
};

const ensureFarmerProfile = async (farmer) => {
  const existing = await UserProfile.findOne({ user_id: farmer._id });
  if (existing?.isProfileComplete) return existing;

  return UserProfile.findOneAndUpdate(
    { user_id: farmer._id },
    {
      user_id: farmer._id,
      profileType: "farmer",
      isProfileComplete: true,
      phone: "+2348000001111",
      country: "Nigeria",
      location: "Lagos",
      state: "Lagos",
      lga: "Ikeja",
      bio: "Demo farmer profile for local matching tests",
      farmerDetails: {
        farmingAreas: ["Mixed Farming"],
        cropsProduced: ["Maize", "Cassava"],
        animalsRaised: ["Poultry (Chickens)"],
        farmSize: "1-5 hectares",
        yearsOfExperience: "3-5 years",
        interests: ["Market Information & Commodity Prices", "Buyer Linkages & Direct Sales"],
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const seed = async () => {
  await mongoose.connect(process.env.CONN_STR, {
    dbName: process.env.DB_NAME || undefined,
  });

  let farmer = await User.findOne({ email: FARMER_EMAIL });
  if (!farmer) {
    farmer = await createLocalUser({
      name: "Abiodun Akinbodewa",
      email: FARMER_EMAIL,
      password: "DemoPass123",
    });
    console.log(`Farmer account did not exist in this DB; created ${FARMER_EMAIL}`);
  }

  await ensureFarmerProfile(farmer);

  const statuses = ["connected", "interested", "potential"];

  for (let i = 0; i < demoVendors.length; i += 1) {
    const vendorUser = await ensureDemoVendor(demoVendors[i]);

    await Match.findOneAndUpdate(
      { farmer_id: farmer._id, vendor_id: vendorUser._id },
      {
        farmer_id: farmer._id,
        vendor_id: vendorUser._id,
        status: statuses[i],
        matchScore: 80 - i * 8,
        reason: "Demo seeded match for local QA",
        initiatedBy: i === 0 ? "farmer" : "vendor",
        dateInterestShown: new Date(),
        farmingAreasMatch: ["Mixed Farming"],
        servicesMatch: demoVendors[i].servicesOffered,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const totalMatches = await Match.countDocuments({ farmer_id: farmer._id });
  console.log(`Seed complete for farmer ${FARMER_EMAIL}. Total matches: ${totalMatches}`);

  await mongoose.disconnect();
};

seed()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("Seed failed:", error.message);
    await mongoose.disconnect();
    process.exit(1);
  });

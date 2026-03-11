const bcrypt = require("bcryptjs");
const User = require("../user");

const toBoolean = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

const getConfiguredSuperAdmin = () => {
  const hasEmail = Boolean(process.env.SUPER_ADMIN_EMAIL);
  const hasPassword = Boolean(process.env.SUPER_ADMIN_PASSWORD);

  if (hasEmail !== hasPassword) {
    console.warn(
      "[super-admin] SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must both be set. Skipping bootstrap."
    );
    return null;
  }

  if (hasEmail && hasPassword) {
    return {
      name: (process.env.SUPER_ADMIN_NAME || "Super Admin").trim(),
      email: process.env.SUPER_ADMIN_EMAIL.trim().toLowerCase(),
      password: process.env.SUPER_ADMIN_PASSWORD,
      source: "env",
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      name: "Super Admin",
      email: "superadmin@farmconnect.local",
      password: "Admin12345",
      source: "dev-default",
    };
  }

  console.warn(
    "[super-admin] No SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD configured in production. Skipping bootstrap."
  );
  return null;
};

const ensureSuperAdmin = async () => {
  const config = getConfiguredSuperAdmin();
  if (!config) {
    return;
  }

  const existingUser = await User.findOne({ email: config.email }).select("+password isAdmin");

  if (!existingUser) {
    const hashedPassword = await bcrypt.hash(config.password, 12);
    await User.create({
      name: config.name,
      email: config.email,
      password: hashedPassword,
      isAdmin: true,
    });

    if (config.source === "dev-default") {
      console.warn(
        `[super-admin] Created default dev super admin: ${config.email} / ${config.password}. Override with SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD.`
      );
    } else {
      console.log(`[super-admin] Created super admin account for ${config.email}.`);
    }

    return;
  }

  let hasChanges = false;

  if (!existingUser.isAdmin) {
    existingUser.isAdmin = true;
    hasChanges = true;
  }

  if (toBoolean(process.env.SUPER_ADMIN_ROTATE_PASSWORD)) {
    existingUser.password = await bcrypt.hash(config.password, 12);
    hasChanges = true;
  }

  if (hasChanges) {
    await existingUser.save();
    console.log(`[super-admin] Updated super admin account for ${config.email}.`);
  }
};

module.exports = { ensureSuperAdmin };

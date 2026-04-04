module.exports = {
  testEnvironment: "node",
  coveragePathIgnorePatterns: ["/node_modules/"],
  collectCoverageFrom: [
    "routes/auth.js",
    "routes/payment.js",
    "routes/adminPayment.js",
    "routes/profile.js",
    "routes/matches.js",
    "workers/trialWorker.js",
    "middleware/requireFeatureAccess.js",
    "utils/subscriptionAccess.js",
  ],
  coverageThreshold: {
    global: {
      branches: 35,
      functions: 45,
      lines: 45,
      statements: 45,
    },
  },
  testMatch: ["**/__tests__/**/*.js", "**/?(*.)+(spec|test).js"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  verbose: true,
  bail: 1,
};

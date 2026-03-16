const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Fullnaame is required"],
      match: [
        /^[A-Za-z]+([ '-][A-Za-z]+)*$/,
        'Please enter a valid full name'
      ],
      trim: true,
      escape: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      escape: true,
      validate: [validator.isEmail, "Please provide a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 8,
      trim: true,
      escape: true,
      select: false,
    },
    googleId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    microsoftId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    // Admin status
    isAdmin: {
      type: Boolean,
      default: false,
    },
    // Account suspension
    isSuspended: {
      type: Boolean,
      default: false,
    },
    suspensionReason: String,
    suspensionDate: Date,
    // Violation tracking
    violationCount: {
      type: Number,
      default: 0,
    },
    violationHistory: [
      {
        type: String,
        timestamp: Date,
      },
    ],
    flaggedMessageCount: {
      type: Number,
      default: 0,
    },
    abuseReportCount: {
      type: Number,
      default: 0,
    },
    isAgent: {
      type: Boolean,
      default: false,
      index: true,
    },
    agentStatus: {
      type: String,
      enum: ["none", "pending", "approved", "declined"],
      default: "none",
      index: true,
    },
    referredByAgentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referredPromoCode: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
    agentWallet: {
      availableBalance: {
        type: Number,
        default: 0,
      },
      lockedBalance: {
        type: Number,
        default: 0,
      },
      lifetimeEarned: {
        type: Number,
        default: 0,
      },
      lifetimeWithdrawn: {
        type: Number,
        default: 0,
      },
    },
    // Last login tracking
    lastLogin: Date,
  },
  {
    timestamps: true,
    toJSON: { transform: true },
    toObject: { transform: true },
  }
);

userSchema.statics.signup = async function ({ name, email, password }) {
  if (!name || !email || !password) {
    throw new Error("Email and password are required");
  }

  if (!validator.isAlpha(name.replace(/\s+/g, ""))) {
    throw new Error("Name must contain only letters");
  }

  if (!validator.isEmail(email)) {
    throw new Error("Invalid email format");
  }

  if (
    !validator.isStrongPassword(password, {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 0,
    })
  ) {
    throw new Error(
      "Password must be at least 8 characters with 1 uppercase letter and 1 number"
    );
  }

  const exists = await this.findOne({ email });
  if (exists) {
    throw new Error("Email already in use");
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const user = await this.create({ name, email, password: hashedPassword });

  return user;
};

userSchema.statics.login = async function ({ email, password }) {
  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  const user = await this.findOne({ email }).select("+password");
  if (!user) {
    throw new Error("Invalid email or password");
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new Error("Invalid email or password");
  }

  return user;
};

userSchema.options.toJSON.transform = (doc, ret) => {
  delete ret.password;
  delete ret.__v;
  return ret;
};

userSchema.index({ email: 1 });

const User = mongoose.model("User", userSchema);
module.exports = User;

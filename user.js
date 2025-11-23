const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Fullnaame is required"],
      validate: [validator.isAlpha, "Name must contain only letters"],
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

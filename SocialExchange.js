const mongoose = require("mongoose");

const socialExchangeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300, // Automatically deletes the document after 5 minutes (300 seconds)
  },
});

const SocialExchange = mongoose.model("SocialExchange", socialExchangeSchema);
module.exports = SocialExchange;

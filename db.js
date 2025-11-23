const moongoese = require("mongoose");
const dotenv = require("dotenv");

const dbConnect = () => {
  moongoese
    .connect(
      process.env.CONN_STR ||
        "mongodb://connectapi:connectapi@mongodb:27017/connectdb?authSource=admin"
    )
    .then(() => {
      console.log("MongoDB connected successfully");
    })
    .catch((error) => {
      console.error("MongoDB connection error:", error);
    });
};

module.exports = dbConnect;

const moongoese = require("mongoose");

const dbConnect = () => {
  if (!process.env.CONN_STR) {
    throw new Error("CONN_STR environment variable is not set");
  }
  moongoese
    .connect(process.env.CONN_STR)
    .then(() => {
      console.log("MongoDB connected successfully");
    })
    .catch((error) => {
      console.error("MongoDB connection error:", error);
    });
};

module.exports = dbConnect;

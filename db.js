const moongoese = require("mongoose");
const dotenv = require("dotenv");

const dbConnect = () => {
  moongoese
    .connect(
      process.env.CONN_STR ||
        "mongodb+srv://connect_db_user:iQedFIijzEs5BmxR@connectdb.n0yqaed.mongodb.net/?appName=Connectdb"
    )
    .then(() => {
      console.log("MongoDB connected successfully");
    })
    .catch((error) => {
      console.error("MongoDB connection error:", error);
    });
};

module.exports = dbConnect;

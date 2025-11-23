const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: Date, default: Date.now },
  location: { type: String, required: true },
  desc: { type: String, required: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});

reportSchema.statics.findByLocation = function (location) {
  return this.find({ location: location });
};

reportSchema.statics.submitReport = function ({ title, date, location, desc }) {
  const report = this.create({ title, date, location, desc });
  return report;
};

const Report = mongoose.model("Report", reportSchema);

module.exports = Report;

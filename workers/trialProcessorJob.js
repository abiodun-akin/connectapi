require("dotenv").config();

const mongoose = require("mongoose");
const { initializeRabbitMQ } = require("../middleware/eventNotification");
const { processTrialExpirations, cancelOverdueTrials } = require("./trialWorker");

async function runTrialProcessorJob() {
  try {
    await initializeRabbitMQ();

    await mongoose.connect(process.env.CONN_STR);

    await processTrialExpirations();
    await cancelOverdueTrials();

    await mongoose.disconnect();
    console.log("[Trial Processor Job] Completed successfully");
  } catch (error) {
    console.error("[Trial Processor Job] Failed:", error);
    process.exitCode = 1;
  } finally {
    try {
      await mongoose.disconnect();
    } catch (_error) {
      // noop
    }
  }
}

if (require.main === module) {
  runTrialProcessorJob()
    .then(() => process.exit(process.exitCode || 0))
    .catch(() => process.exit(1));
}

module.exports = { runTrialProcessorJob };
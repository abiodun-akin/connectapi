/**
 * SMS Notification Worker
 * Completely independent from email worker - runs as separate service
 * Consumes SMS notification queue and sends via beem.africa
 *
 * CRITICAL: This worker is designed to NOT block email notifications
 * If SMS fails or is disabled, email will continue processing independently
 */

const amqplib = require("amqplib");
const axios = require("axios");

// Beem.africa client configuration
const BEEM_BASE_URL = "https://api.beem.africa/v1";
const BEEM_API_KEY = process.env.BEEM_API_KEY;
const BEEM_SECRET_KEY = process.env.BEEM_SECRET_KEY;
const BEEM_FROM_NAME = process.env.BEEM_FROM_NAME || "FarmConnect";

/**
 * SMS templates - concise versions for text message limits
 */
const smsTemplates = {
  "auth.signup": (data) =>
    `Welcome to Farm Connect, ${data.name}! Verify your email to get started.`,

  "auth.password_reset_requested": (data) =>
    `Password reset requested for your Farm Connect account. If this wasn't you, ignore this message.`,

  "auth.password_reset_completed": (data) =>
    `Your Farm Connect password has been reset successfully.`,

  "auth.two_factor_requested": (data) =>
    `Your 2FA code for Farm Connect is: ${data.code}. Valid for ${data.expiresInMinutes} minutes.`,

  "auth.email_verification_requested": (data) =>
    `Verify your Farm Connect email. Check your inbox for verification link.`,

  "payment.success": (data) =>
    `Payment of ₦${(data.amount || 0).toLocaleString()} confirmed. Ref: ${data.reference}. Thank you!`,

  "payment.failed": (data) =>
    `Payment of ₦${(data.amount || 0).toLocaleString()} failed. Please try again or contact support.`,

  "payment.reminder": (data) =>
    `Renewal reminder: Your ${data.plan} plan renews in ${data.daysUntilRenewal} days. Amount: ₦${(data.amount || 0).toLocaleString()}`,

  "trial.reminder": (data) =>
    `${data.daysRemaining} day(s) left in your trial! Upgrade now to continue using Farm Connect.`,

  "trial.daysLeft3": (data) =>
    `Your Farm Connect trial expires in 3 days. Upgrade to continue. Link: https://farmconnect.com/pricing`,

  "trial.daysLeft1": (data) =>
    `URGENT: Your Farm Connect trial expires TOMORROW. Upgrade now to avoid service interruption.`,

  "subscription.converted": (data) =>
    `Trial converted! Your subscription is now active. Enjoy premium features. Amount: ₦${(data.amount || 5000).toLocaleString()}`,

  "subscription.cancelled": (data) =>
    `Your Farm Connect subscription has been cancelled. You can resubscribe anytime.`,

  "subscription.renewalReminder": (data) =>
    `Renewal reminder: Your subscription renews in ${data.daysUntilRenewal} days. Amount: ₦${(data.amount || 0).toLocaleString()}`,

  "activity.newMessage": (data) =>
    `New message from ${data.senderName} on Farm Connect. Reply to stay connected.`,
};

/**
 * Send SMS via beem.africa API
 */
const sendSMS = async (phoneNumber, message, eventType) => {
  try {
    if (!BEEM_API_KEY || !BEEM_SECRET_KEY) {
      console.warn(
        `[SMS] Beem.africa credentials not configured. Skipping SMS for ${eventType}`,
      );
      return false;
    }

    if (!phoneNumber) {
      console.warn(`[SMS] No phone number provided for ${eventType}`);
      return false;
    }

    // Format phone number (ensure it starts with country code)
    const formattedPhone = phoneNumber.startsWith("+")
      ? phoneNumber
      : `+234${phoneNumber.replace(/^0/, "")}`;

    const response = await axios.post(`${BEEM_BASE_URL}/sms/send`, {
      sender_name: BEEM_FROM_NAME,
      message: message,
      phone: formattedPhone,
      api_key: BEEM_API_KEY,
      secret_key: BEEM_SECRET_KEY,
    });

    if (response.data.success) {
      console.log(
        `✓ SMS sent for ${eventType} to ${formattedPhone} | ID: ${response.data.data?.id}`,
      );
      return true;
    } else {
      console.error(
        `✗ SMS failed for ${eventType} to ${formattedPhone}:`,
        response.data.message,
      );
      return false;
    }
  } catch (error) {
    console.error(
      `✗ Failed to send SMS for ${eventType}:`,
      error.response?.data || error.message,
    );
    return false;
  }
};

/**
 * Start SMS notification worker
 * Listens to dedicated SMS queue
 */
const startWorker = async () => {
  try {
    if (!process.env.RABBITMQ_URL) {
      console.error(
        "[SMS] RABBITMQ_URL not configured. SMS worker cannot start.",
      );
      return;
    }

    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Assert SMS-specific queue (separate from email queue)
    const smsQueue = await channel.assertQueue("sms_notifications", {
      durable: true,
    });

    // Bind to SMS events (will be published separately by middleware if SMS enabled)
    await channel.bindQueue(smsQueue.queue, "auth_events", "auth.*");
    await channel.bindQueue(smsQueue.queue, "payment_events", "payment.*");
    await channel.bindQueue(smsQueue.queue, "trial_events", "#");

    console.log("✓ SMS worker started and listening for events");

    // Consume messages from SMS queue
    channel.consume(smsQueue.queue, async (msg) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());
        const eventType = msg.fields.routingKey;

        console.log(
          `[SMS] Dequeued ${eventType} | phone: ${data.phone || "n/a"}`,
        );

        // Get template for this event
        const template = smsTemplates[eventType];
        if (!template) {
          console.warn(`[SMS] No template found for event: ${eventType}`);
          channel.ack(msg); // Ack to prevent retry loop
          return;
        }

        // Generate SMS message
        const messageText =
          typeof template === "function" ? template(data) : template;

        // CRITICAL: Only send if phone number exists
        if (!data.phone) {
          console.warn(
            `[SMS] Skipping ${eventType}: missing phone number (user must opt-in)`,
          );
          channel.ack(msg);
          return;
        }

        // Send SMS
        const sent = await sendSMS(data.phone, messageText, eventType);

        // Acknowledge only if sent successfully
        if (sent) {
          channel.ack(msg);
        } else {
          // Nack to retry later
          console.warn(`[SMS] Nacking ${eventType}: will retry later`);
          channel.nack(msg, false, true);
        }
      } catch (error) {
        console.error(`[SMS] Error processing message:`, error.message);
        channel.nack(msg, false, true); // Retry on error
      }
    });

    // Handle connection errors
    connection.on("error", (err) => {
      console.error("[SMS] RabbitMQ connection error:", err.message);
      setTimeout(startWorker, 5000); // Reconnect after 5 seconds
    });

    connection.on("close", () => {
      console.log("[SMS] RabbitMQ connection closed. Restarting...");
      setTimeout(startWorker, 5000);
    });
  } catch (error) {
    console.error("[SMS] Worker startup failed:", error.message);
    setTimeout(startWorker, 5000);
  }
};

// Start the worker if this is the main module
if (require.main === module) {
  startWorker();
}

module.exports = { startWorker, sendSMS };

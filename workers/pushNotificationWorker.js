/**
 * Push Notification Worker
 * Consumes push notification queue and sends via Firebase Cloud Messaging
 */

const amqplib = require("amqplib");
const {
  sendPushNotification,
  sendPushNotificationToMultiple,
} = require("../services/pushNotificationService");

/**
 * Push notification templates
 */
const pushTemplates = {
  "auth.signup": {
    title: "Welcome to Farm Connect!",
    body: "Your account has been created successfully. Complete your profile to get started.",
  },
  "auth.login": {
    title: "Login Successful",
    body: "You have successfully logged in to your Farm Connect account.",
  },
  "auth.two_factor_requested": {
    title: "2FA Code Sent",
    body: "A two-factor authentication code has been sent to your email.",
  },
  "auth.email_verification_requested": {
    title: "Verify Your Email",
    body: "Please verify your email address to unlock all account features.",
  },
  "payment.success": (data) => ({
    title: "Payment Confirmed",
    body: `Payment of ₦${(data.amount || 0).toLocaleString()} has been confirmed.`,
  }),
  "payment.failed": (data) => ({
    title: "Payment Failed",
    body: `Payment of ₦${(data.amount || 0).toLocaleString()} failed. Please try again.`,
  }),
  "trial.reminder": (data) => ({
    title: "Trial Reminder",
    body: `${data.daysRemaining} day(s) left in your trial. Upgrade now!`,
  }),
  "activity.newMessage": (data) => ({
    title: "New Message",
    body: `New message from ${data.senderName}`,
  }),
  "match.created": (data) => ({
    title: "New Match!",
    body: `You have a new match with ${data.matchedUserName}`,
  }),
};

/**
 * Send push notification
 */
const sendPush = async (userId, eventType, data) => {
  try {
    // Get user's FCM tokens (this would need to be stored in user profile or separate collection)
    // For now, we'll assume tokens are stored in user profile
    const UserProfile = require("../userProfile");
    const profile = await UserProfile.findOne({ user_id: userId });

    if (!profile || !profile.fcmTokens || profile.fcmTokens.length === 0) {
      console.log(`[Push] No FCM tokens found for user ${userId}`);
      return false;
    }

    const template = pushTemplates[eventType];
    if (!template) {
      console.log(`[Push] No template found for event type: ${eventType}`);
      return false;
    }

    const notification =
      typeof template === "function" ? template(data) : template;

    // Send to all user's tokens
    const result = await sendPushNotificationToMultiple(
      profile.fcmTokens,
      notification,
      {
        eventType,
        userId,
        ...data,
      },
    );

    console.log(
      `[Push] Sent notification for ${eventType} to ${profile.fcmTokens.length} devices`,
    );
    return true;
  } catch (error) {
    console.error(
      `[Push] Failed to send push notification for ${eventType}:`,
      error,
    );
    return false;
  }
};

/**
 * Process notification message
 */
const processMessage = async (msg) => {
  try {
    const { eventType, userId, ...data } = JSON.parse(msg.content.toString());

    console.log(`[Push] Processing ${eventType} for user ${userId}`);

    const success = await sendPush(userId, eventType, data);

    if (success) {
      console.log(
        `[Push] ✓ Successfully sent push notification for ${eventType}`,
      );
    } else {
      console.log(`[Push] ✗ Failed to send push notification for ${eventType}`);
    }

    return success;
  } catch (error) {
    console.error("[Push] Error processing message:", error);
    return false;
  }
};

/**
 * Start push notification worker
 */
const startWorker = async () => {
  try {
    if (!process.env.RABBITMQ_URL) {
      console.error(
        "[Push] RABBITMQ_URL not configured. Push worker cannot start.",
      );
      return;
    }

    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    connection.on("error", (err) => {
      console.error("[Push] RabbitMQ connection error:", err.message || err);
    });
    connection.on("close", () => {
      console.warn("[Push] RabbitMQ connection closed. Reconnecting in 5s...");
      setTimeout(startWorker, 5000);
    });
    channel.on("error", (err) => {
      console.error("[Push] RabbitMQ channel error:", err.message || err);
    });

    const exchanges = [
      "auth_events",
      "payment_events",
      "trial_events",
      "activity_events",
      "match_events",
    ];

    for (const exchangeName of exchanges) {
      await channel.assertExchange(exchangeName, "topic", { durable: true });
    }

    // Assert push notification queue
    const pushQueue = await channel.assertQueue("push_notifications", {
      durable: true,
    });

    // Bind to relevant events
    await channel.bindQueue(pushQueue.queue, "auth_events", "auth.*");
    await channel.bindQueue(pushQueue.queue, "payment_events", "payment.*");
    await channel.bindQueue(pushQueue.queue, "trial_events", "#");
    await channel.bindQueue(pushQueue.queue, "activity_events", "activity.*");
    await channel.bindQueue(pushQueue.queue, "match_events", "match.*");

    console.log("✓ Push notification worker started and listening for events");

    // Consume messages from push queue
    channel.consume(pushQueue.queue, async (msg) => {
      if (!msg) return;

      try {
        await processMessage(msg);
        channel.ack(msg);
      } catch (error) {
        console.error("[Push] Error processing message:", error);
        // Don't requeue indefinitely - dead letter after max retries
        channel.nack(msg, false, false);
      }
    });
  } catch (error) {
    console.error("[Push] Failed to start push notification worker:", error);
  }
};

startWorker();

module.exports = {
  startWorker,
  sendPush,
};

const admin = require("firebase-admin");

// Initialize Firebase Admin SDK
let firebaseApp;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // For development, you can use default credentials if available
    firebaseApp = admin.initializeApp();
  }
} catch (error) {
  console.warn("Firebase initialization failed:", error.message);
  firebaseApp = null;
}

/**
 * Send push notification to a single device
 * @param {string} token - FCM token
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendPushNotification = async (token, notification, data = {}) => {
  if (!firebaseApp) {
    console.warn("Firebase not initialized, skipping push notification");
    return null;
  }

  try {
    const message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        icon: notification.icon || "default",
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      data: {
        ...data,
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("Push notification sent successfully:", response);
    return response;
  } catch (error) {
    console.error("Error sending push notification:", error);
    throw error;
  }
};

/**
 * Send push notification to multiple devices
 * @param {string[]} tokens - Array of FCM tokens
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendPushNotificationToMultiple = async (
  tokens,
  notification,
  data = {},
) => {
  if (!firebaseApp) {
    console.warn("Firebase not initialized, skipping push notifications");
    return null;
  }

  try {
    const message = {
      tokens,
      notification: {
        title: notification.title,
        body: notification.body,
        icon: notification.icon || "default",
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      data: {
        ...data,
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendMulticast(message);
    console.log("Multicast push notification sent:", response);
    return response;
  } catch (error) {
    console.error("Error sending multicast push notification:", error);
    throw error;
  }
};

/**
 * Subscribe tokens to a topic
 * @param {string[]} tokens - FCM tokens
 * @param {string} topic - Topic name
 */
const subscribeToTopic = async (tokens, topic) => {
  if (!firebaseApp) {
    console.warn("Firebase not initialized, skipping topic subscription");
    return null;
  }

  try {
    const response = await admin.messaging().subscribeToTopic(tokens, topic);
    console.log("Subscribed to topic:", response);
    return response;
  } catch (error) {
    console.error("Error subscribing to topic:", error);
    throw error;
  }
};

/**
 * Unsubscribe tokens from a topic
 * @param {string[]} tokens - FCM tokens
 * @param {string} topic - Topic name
 */
const unsubscribeFromTopic = async (tokens, topic) => {
  if (!firebaseApp) {
    console.warn("Firebase not initialized, skipping topic unsubscription");
    return null;
  }

  try {
    const response = await admin
      .messaging()
      .unsubscribeFromTopic(tokens, topic);
    console.log("Unsubscribed from topic:", response);
    return response;
  } catch (error) {
    console.error("Error unsubscribing from topic:", error);
    throw error;
  }
};

/**
 * Send notification to a topic
 * @param {string} topic - Topic name
 * @param {object} notification - Notification payload
 * @param {object} data - Additional data payload
 */
const sendNotificationToTopic = async (topic, notification, data = {}) => {
  if (!firebaseApp) {
    console.warn("Firebase not initialized, skipping topic notification");
    return null;
  }

  try {
    const message = {
      topic,
      notification: {
        title: notification.title,
        body: notification.body,
        icon: notification.icon || "default",
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      data: {
        ...data,
        click_action: notification.clickAction || "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          default_sound: true,
          default_vibrate_timings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log("Topic notification sent successfully:", response);
    return response;
  } catch (error) {
    console.error("Error sending topic notification:", error);
    throw error;
  }
};

module.exports = {
  sendPushNotification,
  sendPushNotificationToMultiple,
  subscribeToTopic,
  unsubscribeFromTopic,
  sendNotificationToTopic,
};

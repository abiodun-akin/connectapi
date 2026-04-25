const axios = require("axios");

const BEEM_BASE_URL = "https://api.beem.africa/v1";
const BEEM_API_KEY = process.env.BEEM_API_KEY;
const BEEM_SECRET_KEY = process.env.BEEM_SECRET_KEY;
const BEEM_FROM_NAME = process.env.BEEM_FROM_NAME || "FarmConnect";

/**
 * Send SMS using Beem Africa API
 * @param {string} phoneNumber - Recipient phone number (with country code)
 * @param {string} message - SMS message content
 * @param {object} options - Additional options
 */
const sendSMS = async (phoneNumber, message, options = {}) => {
  try {
    // Validate required environment variables
    if (!BEEM_API_KEY || !BEEM_SECRET_KEY) {
      throw new Error("BEEM API credentials not configured");
    }

    // Ensure phone number has country code
    const formattedPhone = formatPhoneNumber(phoneNumber);

    const payload = {
      source_addr: BEEM_FROM_NAME,
      schedule_time: options.scheduleTime || "",
      encoding: options.encoding || 0,
      message: message,
      recipients: [
        {
          recipient_id: options.recipientId || 1,
          dest_addr: formattedPhone,
        },
      ],
    };

    const auth = Buffer.from(`${BEEM_API_KEY}:${BEEM_SECRET_KEY}`).toString(
      "base64",
    );

    const response = await axios.post(`${BEEM_BASE_URL}/send`, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      timeout: 30000, // 30 seconds timeout
    });

    console.log("SMS sent successfully:", {
      phoneNumber: formattedPhone,
      messageId: response.data?.request_id,
      status: response.data?.code,
    });

    return {
      success: true,
      messageId: response.data?.request_id,
      status: response.data?.code,
      phoneNumber: formattedPhone,
    };
  } catch (error) {
    console.error("Error sending SMS:", error.response?.data || error.message);

    throw new Error(
      `SMS sending failed: ${error.response?.data?.message || error.message}`,
    );
  }
};

/**
 * Send SMS to multiple recipients
 * @param {string[]} phoneNumbers - Array of phone numbers
 * @param {string} message - SMS message content
 * @param {object} options - Additional options
 */
const sendBulkSMS = async (phoneNumbers, message, options = {}) => {
  try {
    if (!BEEM_API_KEY || !BEEM_SECRET_KEY) {
      throw new Error("BEEM API credentials not configured");
    }

    const recipients = phoneNumbers.map((phone, index) => ({
      recipient_id: index + 1,
      dest_addr: formatPhoneNumber(phone),
    }));

    const payload = {
      source_addr: BEEM_FROM_NAME,
      schedule_time: options.scheduleTime || "",
      encoding: options.encoding || 0,
      message: message,
      recipients: recipients,
    };

    const auth = Buffer.from(`${BEEM_API_KEY}:${BEEM_SECRET_KEY}`).toString(
      "base64",
    );

    const response = await axios.post(`${BEEM_BASE_URL}/send`, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      timeout: 60000, // 60 seconds timeout for bulk
    });

    console.log("Bulk SMS sent successfully:", {
      count: phoneNumbers.length,
      messageId: response.data?.request_id,
      status: response.data?.code,
    });

    return {
      success: true,
      messageId: response.data?.request_id,
      status: response.data?.code,
      recipientCount: phoneNumbers.length,
    };
  } catch (error) {
    console.error(
      "Error sending bulk SMS:",
      error.response?.data || error.message,
    );

    throw new Error(
      `Bulk SMS sending failed: ${error.response?.data?.message || error.message}`,
    );
  }
};

/**
 * Check SMS delivery status
 * @param {string} messageId - Message ID from send response
 */
const checkDeliveryStatus = async (messageId) => {
  try {
    if (!BEEM_API_KEY || !BEEM_SECRET_KEY) {
      throw new Error("BEEM API credentials not configured");
    }

    const auth = Buffer.from(`${BEEM_API_KEY}:${BEEM_SECRET_KEY}`).toString(
      "base64",
    );

    const response = await axios.get(`${BEEM_BASE_URL}/report/${messageId}`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      timeout: 30000,
    });

    return {
      messageId,
      status: response.data?.status,
      details: response.data,
    };
  } catch (error) {
    console.error(
      "Error checking delivery status:",
      error.response?.data || error.message,
    );

    throw new Error(
      `Status check failed: ${error.response?.data?.message || error.message}`,
    );
  }
};

/**
 * Format phone number to international format
 * @param {string} phoneNumber - Phone number to format
 */
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return phoneNumber;

  // Remove all non-digit characters
  let cleaned = phoneNumber.replace(/\D/g, "");

  // Handle Nigerian numbers
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    // Convert 08012345678 to 2348012345678
    cleaned = "234" + cleaned.substring(1);
  } else if (cleaned.startsWith("234") && cleaned.length === 13) {
    // Already in correct format
  } else if (!cleaned.startsWith("234")) {
    // Assume it's a Nigerian number without country code
    if (cleaned.length === 10) {
      cleaned = "234" + cleaned;
    }
  }

  return cleaned;
};

/**
 * Validate phone number format
 * @param {string} phoneNumber - Phone number to validate
 */
const validatePhoneNumber = (phoneNumber) => {
  const formatted = formatPhoneNumber(phoneNumber);
  // Nigerian phone number validation (234XXXXXXXXX)
  const nigerianRegex = /^234[789]\d{9}$/;
  return nigerianRegex.test(formatted);
};

module.exports = {
  sendSMS,
  sendBulkSMS,
  checkDeliveryStatus,
  formatPhoneNumber,
  validatePhoneNumber,
};

const axios = require('axios');

const getPaystackSecretKey = () => {
  // Support legacy and current env key names across deployments.
  return process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET || null;
};

/**
 * Verify payment with Paystack API
 * @param {string} reference - Paystack payment reference
 * @returns {Promise<Object>} - Paystack response data
 */
const verifyPaystackPayment = async (reference) => {
  const secretKey = getPaystackSecretKey();

  if (!secretKey) {
    throw new Error('Paystack secret key is not configured');
  }

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      }
    );

    if (!response.data.status) {
      throw new Error('Paystack verification failed');
    }

    return response.data.data;
  } catch (error) {
    const upstreamMessage =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message;

    console.error('Paystack verification error:', upstreamMessage);
    throw new Error(`Unable to verify payment with Paystack: ${upstreamMessage}`);
  }
};

/**
 * Validate Paystack payment response
 */
const validatePaystackResponse = (paystackData) => {
  return (
    paystackData &&
    paystackData.status === 'success' &&
    paystackData.amount &&
    paystackData.reference
  );
};

/**
 * Calculate subscription end date based on plan
 */
const getSubscriptionEndDate = (planName = 'basic') => {
  const endDate = new Date();
  
  if (planName.toLowerCase() === 'basic') {
    // 30 days for basic plan (free trial might be 30 days, paid could be monthly/yearly)
    endDate.setDate(endDate.getDate() + 30);
  } else if (planName.toLowerCase() === 'premium') {
    // 90 days for premium
    endDate.setDate(endDate.getDate() + 90);
  } else if (planName.toLowerCase() === 'enterprise') {
    // 365 days for enterprise
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  return endDate;
};

/**
 * Charge a stored card authorization (deferred billing after trial)
 * @param {string} authCode - Paystack authorization_code from a previous transaction
 * @param {string} email - Customer email (must match original authorization)
 * @param {number} amountNGN - Amount to charge in Naira (e.g. 5000)
 * @returns {Promise<Object>} - Paystack charge response data
 */
const chargeAuthorization = async (authCode, email, amountNGN) => {
  const secretKey = getPaystackSecretKey();
  if (!secretKey) {
    throw new Error('Paystack secret key is not configured');
  }

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/charge_authorization',
      {
        authorization_code: authCode,
        email,
        amount: Math.round(amountNGN * 100), // convert to kobo
      },
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );

    if (!response.data.status) {
      throw new Error('Charge authorization failed');
    }

    return response.data.data;
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    console.error('Charge authorization error:', msg);
    throw new Error(`Unable to charge authorization: ${msg}`);
  }
};

module.exports = {
  verifyPaystackPayment,
  validatePaystackResponse,
  getSubscriptionEndDate,
  getPaystackSecretKey,
  chargeAuthorization,
};

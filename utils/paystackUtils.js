const axios = require('axios');

/**
 * Verify payment with Paystack API
 * @param {string} reference - Paystack payment reference
 * @returns {Promise<Object>} - Paystack response data
 */
const verifyPaystackPayment = async (reference) => {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    if (!response.data.status) {
      throw new Error('Paystack verification failed');
    }

    return response.data.data;
  } catch (error) {
    console.error('Paystack verification error:', error.message);
    throw new Error('Unable to verify payment with Paystack');
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

module.exports = {
  verifyPaystackPayment,
  validatePaystackResponse,
  getSubscriptionEndDate,
};

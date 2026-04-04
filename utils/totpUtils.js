const QRCode = require('qrcode');

/**
 * Generate QR code data URL for TOTP setup
 */
async function generateTOTPQRCode(secret, email) {
  try {
    const otpauth_url = secret.otpauth_url;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth_url);
    return qrCodeDataUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Get TOTP setup response with QR code and secret
 */
async function getTOTPSetupResponse(secret, email) {
  const qrCode = await generateTOTPQRCode(secret, email);
  
  return {
    qrCode, // Data URL for displaying QR code
    secret: secret.base32, // Backup secret key
    manualEntryKey: secret.base32,
    issuer: 'FarmConnect',
    accountName: email,
  };
}

module.exports = {
  generateTOTPQRCode,
  getTOTPSetupResponse,
};

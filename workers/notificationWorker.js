const amqplib = require("amqplib");
const { Resend } = require("resend");
const mongoose = require("mongoose");
const User = require("../user");
const {
  mergeNotificationPreferences,
  resolveEventCategory,
  isCriticalEvent,
  isWithinQuietHours,
} = require("../utils/notificationPreferences");

const resend = new Resend(process.env.RESEND_API_KEY);
const senderEmail =
  process.env.RESEND_FROM_EMAIL || "noreply@farmapp.kwezitechnologiesltd.africa";

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Enhanced email templates with actual content
 */
const emailTemplates = {
  "auth.signup": {
    subject: "Welcome to Farm Connect!",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50;">Welcome to Farm Connect!</h1>
          <p style="color: #555; font-size: 16px;">Hi ${data.name || "User"},</p>
          <p style="color: #555; font-size: 16px;">
            Your account has been created successfully. You can now log in and start exploring our platform.
          </p>
          <div style="margin: 30px 0; padding: 20px; background: #f9f9f9; border-left: 4px solid #27ae60;">
            <p style="color: #555; margin: 0;">
              <strong>Email:</strong> ${data.email}
            </p>
          </div>
          <p style="color: #999; font-size: 14px; margin-top: 20px;">
            If you didn't create this account, please ignore this email.
          </p>
        </div>
      </div>
    `,
  },
  "auth.login": {
    subject: "Login Successful",
    html: (_data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50;">Login Successful</h1>
          <p style="color: #555; font-size: 16px;">You have successfully logged in to your Farm Connect account.</p>
          <p style="color: #999; font-size: 14px; margin-top: 20px;">
            If this wasn't you, please change your password immediately.
          </p>
        </div>
      </div>
    `,
  },
  "auth.logout": {
    subject: "Logged Out",
    html: (_data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50;">Logged Out</h1>
          <p style="color: #555; font-size: 16px;">You have been logged out from your Farm Connect account.</p>
        </div>
      </div>
    `,
  },
  "auth.email_verification_requested": {
    subject: "Verify Your Email - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 560px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50; margin-top: 0;">Verify your email address</h1>
          <p style="color: #555; font-size: 16px;">Hi ${data.name || "there"},</p>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Please confirm your Farm Connect email to unlock all account features.
          </p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${data.verifyUrl || "#"}" style="display: inline-block; padding: 12px 18px; background: #2d8659; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Verify Email
            </a>
          </div>
          <p style="color: #777; font-size: 14px; line-height: 1.5;">
            If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="word-break: break-all; color: #2d8659; font-size: 14px;">${data.verifyUrl || "N/A"}</p>
          <p style="color: #999; font-size: 13px; margin-top: 20px;">
            This link expires in ${data.expiresInHours || 24} hours.
          </p>
        </div>
      </div>
    `,
  },
  "auth.two_factor_requested": {
    subject: "Your Farm Connect 2FA Code",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 560px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50; margin-top: 0;">Two-Factor Authentication</h1>
          <p style="color: #555; font-size: 16px;">Hi ${data.name || "there"},</p>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            Use the code below to complete your sign in:
          </p>
          <div style="margin: 22px 0; text-align: center;">
            <span style="display: inline-block; letter-spacing: 6px; font-size: 32px; font-weight: 700; color: #193325; background: #eef6f2; border-radius: 8px; padding: 10px 16px;">${data.code || "------"}</span>
          </div>
          <p style="color: #777; font-size: 14px; line-height: 1.5;">
            This code expires in ${data.expiresInMinutes || 10} minutes. If you did not request this sign in, please reset your password.
          </p>
        </div>
      </div>
    `,
  },
  "auth.password_reset_requested": {
    subject: "Password Reset Requested - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 560px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50; margin-top: 0;">Password Reset Request</h1>
          <p style="color: #555; font-size: 16px;">Hi ${data.name || "there"},</p>
          <p style="color: #555; font-size: 16px; line-height: 1.6;">
            We received a request to reset your Farm Connect password.
          </p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${data.resetUrl || "#"}" style="display: inline-block; padding: 12px 18px; background: #2d8659; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Reset Password
            </a>
          </div>
          <p style="color: #777; font-size: 14px; line-height: 1.5;">
            If the button does not work, copy and paste this link into your browser:
          </p>
          <p style="word-break: break-all; color: #2d8659; font-size: 14px;">${data.resetUrl || "N/A"}</p>
          <p style="color: #999; font-size: 13px; margin-top: 20px;">
            This link expires in ${data.expiresInMinutes || 30} minutes.
          </p>
          <p style="color: #999; font-size: 13px;">
            If you did not request this, you can ignore this message.
          </p>
        </div>
      </div>
    `,
  },
  "payment.initialized": {
    subject: "Payment Started - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50;">Payment Started</h1>
          <p style="color: #555; font-size: 16px;">Your payment process has been initiated.</p>
          <div style="margin: 30px 0; padding: 20px; background: #f9f9f9; border-left: 4px solid #3498db;">
            <p style="color: #555; margin: 5px 0;"><strong>Plan:</strong> ${data.plan}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Amount:</strong> ₦${data.amount.toLocaleString()}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Reference:</strong> ${data.reference}</p>
          </div>
        </div>
      </div>
    `,
  },
  "payment.verified": {
    subject: "Payment Verified - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #2c3e50;">Payment Verified</h1>
          <p style="color: #555; font-size: 16px;">Your payment has been verified successfully.</p>
          <div style="margin: 30px 0; padding: 20px; background: #f9f9f9; border-left: 4px solid #27ae60;">
            <p style="color: #555; margin: 5px 0;"><strong>Reference:</strong> ${data.reference}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Amount:</strong> ₦${data.amount.toLocaleString()}</p>
          </div>
        </div>
      </div>
    `,
  },
  "payment.success": {
    subject: "Subscription Activated - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #27ae60;">🎉 Subscription Activated!</h1>
          <p style="color: #555; font-size: 16px;">Congratulations! Your subscription has been activated.</p>
          <div style="margin: 30px 0; padding: 20px; background: #f0f7f4; border-left: 4px solid #27ae60; border-radius: 4px;">
            <p style="color: #555; margin: 5px 0;"><strong>Plan:</strong> ${data.plan}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Amount:</strong> ₦${data.amount.toLocaleString()}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Active Until:</strong> ${new Date(data.subscriptionEndDate).toLocaleDateString()}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Reference:</strong> ${data.reference}</p>
          </div>
          <p style="color: #555; font-size: 16px; margin-top: 20px;">
            You can now access all premium features. Thank you for your subscription!
          </p>
        </div>
      </div>
    `,
  },
  "payment.reminder": {
    subject: "Upcoming Subscription Renewal - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #e67e22;">Renewal Reminder</h1>
          <p style="color: #555; font-size: 16px;">Your <strong>${data.plan || "subscription"}</strong> plan will renew in <strong>${data.daysUntilRenewal ?? "a few"}</strong> day(s).</p>
          <div style="margin: 20px 0; padding: 16px; background: #fef9e7; border-left: 4px solid #f39c12; border-radius: 4px;">
            <p style="color: #555; margin: 5px 0;"><strong>Renewal Date:</strong> ${data.renewalDate ? new Date(data.renewalDate).toLocaleDateString() : "N/A"}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Amount:</strong> ₦${(data.amount || 0).toLocaleString()}</p>
          </div>
          <p style="color: #555; font-size: 15px;">No action is required if your card details are up to date.</p>
        </div>
      </div>
    `,
  },
  "payment.closed": {
    subject: "Payment Cancelled - Farm Connect",
    html: (_data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #e74c3c;">Payment Cancelled</h1>
          <p style="color: #555; font-size: 16px;">Your payment process has been cancelled.</p>
          <p style="color: #555; font-size: 16px; margin-top: 20px;">
            If you need help, feel free to contact our support team.
          </p>
        </div>
      </div>
    `,
  },
  "trial.reminder": {
    subject: "Your Free Trial Ends Soon - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #e67e22;">⏰ Trial Ending in ${data.daysRemaining} Day${data.daysRemaining !== 1 ? "s" : ""}</h1>
          <p style="color: #555; font-size: 16px;">Your Farm Connect free trial expires on <strong>${new Date(data.trialEndDate).toLocaleDateString()}</strong>.</p>
          ${
            data.isCardAuthorized
              ? `<div style="margin: 20px 0; padding: 16px; background: #eafaf1; border-left: 4px solid #27ae60; border-radius: 4px;">
                <p style="color: #555; margin: 0;">✅ Your card is on file. <strong>₦5,000</strong> will be charged automatically when your trial ends.</p>
               </div>`
              : `<div style="margin: 20px 0; padding: 16px; background: #fef9e7; border-left: 4px solid #f39c12; border-radius: 4px;">
                <p style="color: #555; margin: 0;">⚠️ No payment method on file. Please <a href="${process.env.APP_URL || "https://farmconnect.com"}/pricing" style="color: #2980b9;">set up billing</a> to continue after your trial.</p>
               </div>`
          }
          <p style="color: #999; font-size: 14px; margin-top: 20px;">If you cancel before your trial ends, you will not be charged.</p>
        </div>
      </div>
    `,
  },
  "subscription.converted": {
    subject: "Subscription Activated - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #27ae60;">🎉 Subscription Active!</h1>
          <p style="color: #555; font-size: 16px;">Your free trial has ended and your subscription has been activated.</p>
          <div style="margin: 20px 0; padding: 20px; background: #f0f7f4; border-left: 4px solid #27ae60; border-radius: 4px;">
            <p style="color: #555; margin: 5px 0;"><strong>Amount Charged:</strong> ₦${(data.amount || 5000).toLocaleString()}</p>
            <p style="color: #555; margin: 5px 0;"><strong>Active Until:</strong> ${data.endDate ? new Date(data.endDate).toLocaleDateString() : "N/A"}</p>
          </div>
          <p style="color: #555; font-size: 16px;">Thank you for subscribing to Farm Connect!</p>
        </div>
      </div>
    `,
  },
  "subscription.cancelled": {
    subject: "Subscription Cancelled - Farm Connect",
    html: (data) => `
      <div style="font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px;">
        <div style="background: white; max-width: 500px; margin: 0 auto; padding: 30px; border-radius: 8px;">
          <h1 style="color: #e74c3c;">Subscription Cancelled</h1>
          <p style="color: #555; font-size: 16px;">Your Farm Connect subscription has been cancelled.</p>
          ${data.reason ? `<p style="color: #777; font-size: 14px;">Reason: ${data.reason}</p>` : ""}
          <p style="color: #555; font-size: 16px; margin-top: 20px;">
            You can <a href="${process.env.APP_URL || "https://farmconnect.com"}/pricing" style="color: #2980b9;">resubscribe at any time</a>.
          </p>
        </div>
      </div>
    `,
  },
};

const sendEmailRaw = async (email, subject, html) => {
  if (!process.env.RESEND_API_KEY) {
    console.error("[Email] RESEND_API_KEY not set — cannot send email");
    return false;
  }

  const result = await resend.emails.send({
    from: senderEmail,
    to: email,
    subject,
    html,
  });

  return !result?.error;
};

const loadNotificationContext = async (data = {}) => {
  let user = null;
  if (data.userId) {
    user = await User.findById(data.userId)
      .select("email notificationPreferences")
      .lean();
  }

  if (!user && data.email) {
    user = await User.findOne({
      email: String(data.email).trim().toLowerCase(),
    })
      .select("email notificationPreferences")
      .lean();
  }

  return {
    email: user?.email || data.email || null,
    preferences: mergeNotificationPreferences(user?.notificationPreferences),
  };
};

const formatSmsBody = (eventType, data = {}) => {
  const category = resolveEventCategory(eventType);
  const prefix =
    category === "security"
      ? "Security"
      : category === "billing"
        ? "Billing"
        : category === "matches"
          ? "Match"
          : category === "messages"
            ? "Message"
            : "Update";
  const text = String(data.status || data.message || eventType)
    .replace(/\s+/g, " ")
    .trim();
  return `FarmConnect ${prefix}: ${text}`.slice(0, 320);
};

const sendSmsGateway = async ({ phoneNumber, gatewayDomain, body }) => {
  const to = `${phoneNumber}@${gatewayDomain}`;
  return sendEmailRaw(
    to,
    "FarmConnect Alert",
    `<div style="font-family: Arial, sans-serif; white-space: pre-wrap;">${escapeHtml(body)}</div>`,
  );
};

const sendEmail = async (_email, eventType, data) => {
  try {
    const { email, preferences } = await loadNotificationContext(data);

    if (!email) {
      console.warn(`Skipping ${eventType}: missing recipient email`);
      return;
    }

    const template = emailTemplates[eventType];
    if (!template) {
      console.warn(`No email template found for event: ${eventType}`);
      return;
    }

    const htmlContent =
      typeof template.html === "function" ? template.html(data) : template.html;

    const critical = isCriticalEvent(eventType);
    const eventCategory = resolveEventCategory(eventType);
    const allowsCategory = Boolean(preferences.eventTypes[eventCategory]);
    const inQuietHours = isWithinQuietHours(preferences.quietHours);

    if (!critical && !allowsCategory) {
      return;
    }

    const canUseSms =
      preferences.channels.sms &&
      preferences.offline.subscribed &&
      preferences.offline.phoneNumber &&
      preferences.offline.gatewayDomain &&
      (!inQuietHours || critical);

    let smsDelivered = false;
    let emailDelivered = false;

    if (canUseSms) {
      try {
        smsDelivered = await sendSmsGateway({
          phoneNumber: preferences.offline.phoneNumber,
          gatewayDomain: preferences.offline.gatewayDomain,
          body: formatSmsBody(eventType, data),
        });
        if (smsDelivered) {
          console.log(`✓ SMS-gateway delivered for ${eventType}`);
        }
      } catch (smsError) {
        console.error(
          `✗ SMS-gateway failed for ${eventType}:`,
          smsError.message,
        );
        if (!preferences.offline.fallbackToEmail && !critical) {
          return;
        }
      }
    }

    const shouldSendEmail = preferences.channels.email || critical;

    if (shouldSendEmail) {
      emailDelivered = await sendEmailRaw(email, template.subject, htmlContent);
      if (emailDelivered) {
        console.log(`✓ Email sent for ${eventType} to ${email}`);
      } else {
        console.error(`✗ Failed to send email for ${eventType} to ${email}`);
      }
    }

    if (smsDelivered || emailDelivered) {
      return true;
    }

    if (!shouldSendEmail && !smsDelivered) {
      console.warn(`⚠️ No delivery channel available for ${eventType}`);
    }
  } catch (error) {
    console.error(`✗ Failed to send email for ${eventType}:`, error.message);
  }
};

const startWorker = async () => {
  try {
    await mongoose.connect(process.env.CONN_STR || "", {
      serverSelectionTimeoutMS: 10000,
    });

    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange("auth_events", "topic", { durable: true });
    await channel.assertExchange("payment_events", "topic", { durable: true });
    await channel.assertExchange("trial_events", "topic", { durable: true });

    const authQueue = await channel.assertQueue("auth_notifications", {
      durable: true,
    });
    const paymentQueue = await channel.assertQueue("payment_notifications", {
      durable: true,
    });
    const trialQueue = await channel.assertQueue("trial_notifications", {
      durable: true,
    });

    await channel.bindQueue(authQueue.queue, "auth_events", "auth.*");
    await channel.bindQueue(paymentQueue.queue, "payment_events", "payment.*");
    await channel.bindQueue(trialQueue.queue, "trial_events", "#");

    channel.consume(authQueue.queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          const eventType = msg.fields.routingKey;
          const delivered = await sendEmail(data.email, eventType, data);
          if (delivered) {
            channel.ack(msg);
          } else {
            channel.nack(msg, false, true);
          }
        } catch (error) {
          console.error("Error processing auth message:", error);
          channel.nack(msg, false, true); // Requeue on error
        }
      }
    });

    channel.consume(paymentQueue.queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          const eventType = msg.fields.routingKey;
          const delivered = await sendEmail(data.email, eventType, data);
          if (delivered) {
            channel.ack(msg);
          } else {
            channel.nack(msg, false, true);
          }
        } catch (error) {
          console.error("Error processing payment message:", error);
          channel.nack(msg, false, true); // Requeue on error
        }
      }
    });

    channel.consume(trialQueue.queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          const eventType = msg.fields.routingKey;
          const delivered = await sendEmail(data.email, eventType, data);
          if (delivered) {
            channel.ack(msg);
          } else {
            channel.nack(msg, false, true);
          }
        } catch (error) {
          console.error("Error processing trial message:", error);
          channel.nack(msg, false, true); // Requeue on error
        }
      }
    });

    console.log("✓ Notification worker started and listening for events");
  } catch (error) {
    console.error("✗ Worker failed:", error.message);
    console.log("Retrying in 5 seconds...");
    setTimeout(startWorker, 5000);
  }
};

startWorker();

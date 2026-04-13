const amqplib = require("amqplib");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const senderEmail =
  process.env.RESEND_FROM_EMAIL || "noreply@farmapp.kwezitechnologiesltd.africa";
const isProduction = process.env.NODE_ENV === "production";

const isRabbitConnectionError = (error) => {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const stack = `${code} ${message}`;

  return [
    "econnrefused",
    "enotfound",
    "eai_again",
    "socket closed unexpectedly",
    "authentication failure",
    "access refused",
    "getaddrinfo",
  ].some((token) => stack.includes(token));
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatTimestamp = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return `${date.toISOString()} UTC`;
};

const formatLocation = (location = {}) => {
  const city = location?.city;
  const region = location?.region;
  const country = location?.country;
  const parts = [city, region, country].filter(Boolean);
  return parts.length ? parts.join(", ") : "Unavailable";
};

const renderAuthSecurityDetails = (data = {}) => {
  const rows = [
    ["Time", formatTimestamp(data.timestamp)],
    ["IP Address", data.ipAddress || "Unavailable"],
    ["Location", formatLocation(data.location)],
    ["Auth Method", data.authMethod || data.provider || "Unavailable"],
    ["User Agent", data.userAgent || "Unavailable"],
    ["Request ID", data.requestId || "Unavailable"],
    [
      "Route",
      data.path ? `${data.method || "UNKNOWN"} ${data.path}` : "Unavailable",
    ],
  ];

  const renderedRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 10px;border:1px solid #ddd;"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 10px;border:1px solid #ddd;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<table style="border-collapse:collapse;width:100%;max-width:720px;margin-top:12px;">${renderedRows}</table>`;
};

const emailTemplates = {
  "auth.signup": {
    subject: "Welcome to Farm Connect - Security Activity Log",
    html: (data) =>
      `<h1>Welcome to Farm Connect</h1><p>Your account was created successfully. Keep this activity record for your security monitoring.</p>${renderAuthSecurityDetails(data)}<p style="margin-top:14px;">If this was not you, reset your password immediately and contact support.</p>`,
  },
  "auth.login": {
    subject: "Security Notice: New Login Detected",
    html: (data) =>
      `<h1>Login Successful</h1><p>We detected a sign-in to your Farm Connect account.</p>${renderAuthSecurityDetails(data)}<p style="margin-top:14px;">If this login was not initiated by you, change your password now and revoke active sessions.</p>`,
  },
  "auth.logout": {
    subject: "Security Notice: Logout Recorded",
    html: (data) =>
      `<h1>Logged Out</h1><p>Your account session was closed.</p>${renderAuthSecurityDetails(data)}<p style="margin-top:14px;">If you did not perform this action, secure your account immediately.</p>`,
  },
  "auth.password_reset_requested": {
    subject: "Password Reset Requested",
    html: (data) =>
      `<h1>Password Reset Request</h1><p>We received a request to reset your Farm Connect password.</p><p><a href="${escapeHtml(data.resetUrl)}" style="display:inline-block;padding:10px 16px;background:#14532d;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a></p><p>This link expires in ${escapeHtml(data.expiresInMinutes || 30)} minutes.</p>${renderAuthSecurityDetails(data)}<p style="margin-top:14px;">If you did not request this change, you can ignore this email and your password will remain unchanged.</p>`,
  },
  "auth.password_reset_completed": {
    subject: "Password Changed Successfully",
    html: (data) =>
      `<h1>Password Reset Successful</h1><p>Your Farm Connect password has been changed.</p>${renderAuthSecurityDetails(data)}<p style="margin-top:14px;">If this was not you, contact support immediately and secure your account.</p>`,
  },
  "auth.email_verification_requested": {
    subject: "Verify your Farm Connect email address",
    html: (data) =>
      `<h1>Verify Your Email</h1><p>Thanks for signing up! Please verify your Farm Connect email address by clicking the button below.</p><p><a href="${escapeHtml(data.verifyUrl)}" style="display:inline-block;padding:10px 16px;background:#14532d;color:#fff;text-decoration:none;border-radius:6px;">Verify Email</a></p><p>This link expires in ${escapeHtml(String(data.expiresInHours || 24))} hours.</p><p>If you did not create an account on Farm Connect, you can safely ignore this email.</p>`,
  },
  "payment.initialized": {
    subject: "Payment Started",
    html: "<h1>Payment Started</h1><p>Your payment process has started.</p>",
  },
  "payment.verified": {
    subject: "Payment Verified",
    html: "<h1>Payment Verified</h1><p>Your payment has been verified.</p>",
  },
  "payment.success": {
    subject: "Payment Successful",
    html: "<h1>Payment Successful</h1><p>Your payment was completed successfully.</p>",
  },
  "payment.reminder": {
    subject: "Upcoming Subscription Renewal",
    html: (data) =>
      `<h1>Subscription Renewal Reminder</h1><p>Your ${escapeHtml(data.plan || "subscription")} plan will renew in ${escapeHtml(String(data.daysUntilRenewal ?? "a few"))} day(s).</p><p>Renewal date: ${escapeHtml(data.renewalDate ? new Date(data.renewalDate).toLocaleDateString() : "N/A")}</p><p>Amount: ₦${escapeHtml(Number(data.amount || 0).toLocaleString())}</p><p>If you already updated your billing preferences, no further action is required.</p>`,
  },
  "payment.closed": {
    subject: "Payment Cancelled",
    html: "<h1>Payment Cancelled</h1><p>Your payment process was cancelled.</p>",
  },
  "trial.reminder": {
    subject: "Your Trial Ends Soon",
    html: "<h1>Trial Ending Soon</h1><p>Your Farm Connect trial is close to expiring.</p>",
  },
  "subscription.converted": {
    subject: "Trial Converted to Subscription",
    html: "<h1>Subscription Active</h1><p>Your trial has been converted to a paid subscription.</p>",
  },
  "subscription.cancelled": {
    subject: "Subscription Cancelled",
    html: "<h1>Subscription Cancelled</h1><p>Your subscription has been cancelled.</p>",
  },
};

const sendEmail = async (email, eventType, data) => {
  try {
    if (!email) {
      console.warn(
        `[Email] Skipping ${eventType}: missing recipient email | data: ${JSON.stringify(data)}`,
      );
      return false;
    }

    const template = emailTemplates[eventType];
    if (!template) {
      console.warn(
        `[Email] No template found for event type: ${eventType} — skipping`,
      );
      return false;
    }

    if (!process.env.RESEND_API_KEY) {
      console.error("[Email] RESEND_API_KEY not set — cannot send email");
      return false;
    }

    const htmlContent =
      typeof template.html === "function" ? template.html(data) : template.html;

    console.log(
      `[Email] Sending ${eventType} to ${email} via Resend (from: ${senderEmail})`,
    );
    const result = await resend.emails.send({
      from: senderEmail,
      to: email,
      subject: template.subject,
      html: htmlContent,
    });

    if (result?.error) {
      console.error(
        `[Email] Resend returned error for ${eventType} to ${email}:`,
        JSON.stringify(result.error),
      );
      return false;
    } else {
      console.log(
        `[Email] Sent ${eventType} to ${email} | Resend id: ${result?.data?.id || "unknown"}`,
      );
      return true;
    }
  } catch (error) {
    console.error(
      `[Email] Exception sending ${eventType} to ${email}:`,
      error.message,
    );
    return false;
  }
};

const processMessages = async () => {
  if (!process.env.RABBITMQ_URL) {
    if (process.env.RABBITMQ_HTTP_API) {
      console.warn(
        "[Cron] RABBITMQ_HTTP_API is set but RABBITMQ_URL is missing. Use AMQP/AMQPS URL for queue processing.",
      );
    }

    if (isProduction) {
      throw new Error(
        "RABBITMQ_URL is required in production to process notifications",
      );
    }

    console.warn(
      "[Cron] RABBITMQ_URL is not set, skipping notification queue drain",
    );
    return 0;
  }

  try {
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

    let processed = 0;

    console.log(
      `[Cron] Queue depths — auth: ${authQueue.messageCount}, payment: ${paymentQueue.messageCount}, trial: ${trialQueue.messageCount}`,
    );

    const processQueue = async (queueName) => {
      let msg = await channel.get(queueName);
      if (!msg) {
        console.log(`[Cron] Queue ${queueName} is empty`);
      }
      while (msg) {
        const data = JSON.parse(msg.content.toString());
        const eventType = msg.fields.routingKey;
        console.log(
          `[Cron] Dequeued ${eventType} from ${queueName} | email: ${data.email || "n/a"}`,
        );
        const sent = await sendEmail(data.email, eventType, data);
        if (!sent) {
          // Leave message unacked so it is requeued when connection closes.
          console.warn(
            `[Cron] Delivery failed for ${eventType} from ${queueName}; stopping queue drain to retry later`,
          );
          break;
        }

        channel.ack(msg);
        processed++;
        msg = await channel.get(queueName);
      }
    };

    await processQueue(authQueue.queue);
    await processQueue(paymentQueue.queue);
    await processQueue(trialQueue.queue);

    console.log(`[Cron] Finished — processed ${processed} messages`);
    await connection.close();
    return processed;
  } catch (error) {
    if (isRabbitConnectionError(error)) {
      if (isProduction) {
        throw new Error(
          `RabbitMQ connection failed in production: ${error.message}`,
        );
      }

      console.warn(
        "[Cron] RabbitMQ unavailable, skipping notification queue drain:",
        error.message,
      );
      return 0;
    }

    console.error("Cron job failed:", error);
    throw error;
  }
};

const getQueueStats = async () => {
  if (!process.env.RABBITMQ_URL) {
    if (isProduction) {
      throw new Error(
        "RABBITMQ_URL is required in production to inspect queue stats",
      );
    }

    return {
      queues: {
        auth_notifications: { messages: 0, consumers: 0 },
        payment_notifications: { messages: 0, consumers: 0 },
        trial_notifications: { messages: 0, consumers: 0 },
      },
      totals: {
        messages: 0,
        consumers: 0,
      },
      source: "unavailable",
    };
  }

  try {
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

    const queues = {
      auth_notifications: {
        messages: authQueue.messageCount || 0,
        consumers: authQueue.consumerCount || 0,
      },
      payment_notifications: {
        messages: paymentQueue.messageCount || 0,
        consumers: paymentQueue.consumerCount || 0,
      },
      trial_notifications: {
        messages: trialQueue.messageCount || 0,
        consumers: trialQueue.consumerCount || 0,
      },
    };

    const totals = {
      messages:
        queues.auth_notifications.messages +
        queues.payment_notifications.messages +
        queues.trial_notifications.messages,
      consumers:
        queues.auth_notifications.consumers +
        queues.payment_notifications.consumers +
        queues.trial_notifications.consumers,
    };

    await connection.close();

    return {
      queues,
      totals,
      source: "rabbitmq",
    };
  } catch (error) {
    if (isRabbitConnectionError(error)) {
      if (isProduction) {
        throw new Error(
          `RabbitMQ connection failed in production: ${error.message}`,
        );
      }

      return {
        queues: {
          auth_notifications: { messages: 0, consumers: 0 },
          payment_notifications: { messages: 0, consumers: 0 },
          trial_notifications: { messages: 0, consumers: 0 },
        },
        totals: {
          messages: 0,
          consumers: 0,
        },
        source: "unavailable",
      };
    }

    throw error;
  }
};

if (require.main === module) {
  processMessages()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { processMessages, getQueueStats };

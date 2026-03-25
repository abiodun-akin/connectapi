const amqplib = require("amqplib");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);
const senderEmail =
  process.env.RESEND_FROM_EMAIL || "noreply@kwezitechnologiesltd.africa";

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
          <h1 style="color: #e67e22;">⏰ Trial Ending in ${data.daysRemaining} Day${data.daysRemaining !== 1 ? 's' : ''}</h1>
          <p style="color: #555; font-size: 16px;">Your Farm Connect free trial expires on <strong>${new Date(data.trialEndDate).toLocaleDateString()}</strong>.</p>
          ${data.isCardAuthorized
            ? `<div style="margin: 20px 0; padding: 16px; background: #eafaf1; border-left: 4px solid #27ae60; border-radius: 4px;">
                <p style="color: #555; margin: 0;">✅ Your card is on file. <strong>₦5,000</strong> will be charged automatically when your trial ends.</p>
               </div>`
            : `<div style="margin: 20px 0; padding: 16px; background: #fef9e7; border-left: 4px solid #f39c12; border-radius: 4px;">
                <p style="color: #555; margin: 0;">⚠️ No payment method on file. Please <a href="${process.env.APP_URL || 'https://farmconnect.com'}/pricing" style="color: #2980b9;">set up billing</a> to continue after your trial.</p>
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
            <p style="color: #555; margin: 5px 0;"><strong>Active Until:</strong> ${data.endDate ? new Date(data.endDate).toLocaleDateString() : 'N/A'}</p>
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
          ${data.reason ? `<p style="color: #777; font-size: 14px;">Reason: ${data.reason}</p>` : ''}
          <p style="color: #555; font-size: 16px; margin-top: 20px;">
            You can <a href="${process.env.APP_URL || 'https://farmconnect.com'}/pricing" style="color: #2980b9;">resubscribe at any time</a>.
          </p>
        </div>
      </div>
    `,
  },
};

const sendEmail = async (email, eventType, data) => {
  try {
    if (!email) {
      console.warn(`Skipping ${eventType}: missing recipient email`);
      return;
    }

    const template = emailTemplates[eventType];
    if (!template) {
      console.warn(`No email template found for event: ${eventType}`);
      return;
    }

    const htmlContent = typeof template.html === 'function' 
      ? template.html(data) 
      : template.html;

    await resend.emails.send({
      from: senderEmail,
      to: email,
      subject: template.subject,
      html: htmlContent,
    });

    console.log(`✓ Email sent for ${eventType} to ${email}`);
  } catch (error) {
    console.error(`✗ Failed to send email for ${eventType}:`, error.message);
  }
};

const startWorker = async () => {
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

    channel.consume(authQueue.queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          const eventType = msg.fields.routingKey;
          await sendEmail(data.email, eventType, data);
          channel.ack(msg);
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
          await sendEmail(data.email, eventType, data);
          channel.ack(msg);
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
          await sendEmail(data.email, eventType, data);
          channel.ack(msg);
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

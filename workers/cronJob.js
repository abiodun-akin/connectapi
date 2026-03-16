const amqplib = require('amqplib');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const senderEmail = process.env.RESEND_FROM_EMAIL || 'noreply@farmconnect.com';
const isProduction = process.env.NODE_ENV === 'production';

const isRabbitConnectionError = (error) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const stack = `${code} ${message}`;

  return [
    'econnrefused',
    'enotfound',
    'eai_again',
    'socket closed unexpectedly',
    'authentication failure',
    'access refused',
    'getaddrinfo',
  ].some((token) => stack.includes(token));
};

const emailTemplates = {
  'auth.signup': {
    subject: 'Welcome to Farm Connect!',
    html: '<h1>Welcome!</h1><p>Your account has been created successfully.</p>',
  },
  'auth.login': {
    subject: 'Login Successful',
    html: '<h1>Login Successful</h1><p>You have logged in to your account.</p>',
  },
  'auth.logout': {
    subject: 'Logged Out',
    html: '<h1>Logged Out</h1><p>You have been logged out.</p>',
  },
  'payment.initialized': {
    subject: 'Payment Started',
    html: '<h1>Payment Started</h1><p>Your payment process has started.</p>',
  },
  'payment.verified': {
    subject: 'Payment Verified',
    html: '<h1>Payment Verified</h1><p>Your payment has been verified.</p>',
  },
  'payment.success': {
    subject: 'Payment Successful',
    html: '<h1>Payment Successful</h1><p>Your payment was completed successfully.</p>',
  },
  'payment.closed': {
    subject: 'Payment Cancelled',
    html: '<h1>Payment Cancelled</h1><p>Your payment process was cancelled.</p>',
  },
  'trial.reminder': {
    subject: 'Your Trial Ends Soon',
    html: '<h1>Trial Ending Soon</h1><p>Your Farm Connect trial is close to expiring.</p>',
  },
  'subscription.converted': {
    subject: 'Trial Converted to Subscription',
    html: '<h1>Subscription Active</h1><p>Your trial has been converted to a paid subscription.</p>',
  },
  'subscription.cancelled': {
    subject: 'Subscription Cancelled',
    html: '<h1>Subscription Cancelled</h1><p>Your subscription has been cancelled.</p>',
  },
};

const sendEmail = async (email, eventType, data) => {
  try {
    if (!email) {
      console.warn(`[Email] Skipping ${eventType}: missing recipient email | data: ${JSON.stringify(data)}`);
      return;
    }

    const template = emailTemplates[eventType];
    if (!template) {
      console.warn(`[Email] No template found for event type: ${eventType} — skipping`);
      return;
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('[Email] RESEND_API_KEY not set — cannot send email');
      return;
    }

    const htmlContent = typeof template.html === 'function'
      ? template.html(data)
      : template.html;

    console.log(`[Email] Sending ${eventType} to ${email} via Resend (from: ${senderEmail})`);
    const result = await resend.emails.send({
      from: senderEmail,
      to: email,
      subject: template.subject,
      html: htmlContent,
    });

    if (result?.error) {
      console.error(`[Email] Resend returned error for ${eventType} to ${email}:`, JSON.stringify(result.error));
    } else {
      console.log(`[Email] Sent ${eventType} to ${email} | Resend id: ${result?.data?.id || 'unknown'}`);
    }
  } catch (error) {
    console.error(`[Email] Exception sending ${eventType} to ${email}:`, error.message);
  }
};

const processMessages = async () => {
  if (!process.env.RABBITMQ_URL) {
    if (process.env.RABBITMQ_HTTP_API) {
      console.warn('[Cron] RABBITMQ_HTTP_API is set but RABBITMQ_URL is missing. Use AMQP/AMQPS URL for queue processing.');
    }

    if (isProduction) {
      throw new Error('RABBITMQ_URL is required in production to process notifications');
    }

    console.warn('[Cron] RABBITMQ_URL is not set, skipping notification queue drain');
    return 0;
  }

  try {
    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange('auth_events', 'topic', { durable: true });
    await channel.assertExchange('payment_events', 'topic', { durable: true });
    await channel.assertExchange('trial_events', 'topic', { durable: true });

    const authQueue = await channel.assertQueue('auth_notifications', { durable: true });
    const paymentQueue = await channel.assertQueue('payment_notifications', { durable: true });
    const trialQueue = await channel.assertQueue('trial_notifications', { durable: true });

    await channel.bindQueue(authQueue.queue, 'auth_events', 'auth.*');
    await channel.bindQueue(paymentQueue.queue, 'payment_events', 'payment.*');
    await channel.bindQueue(trialQueue.queue, 'trial_events', '#');

    let processed = 0;

    console.log(`[Cron] Queue depths — auth: ${authQueue.messageCount}, payment: ${paymentQueue.messageCount}, trial: ${trialQueue.messageCount}`);

    const processQueue = async (queueName) => {
      let msg = await channel.get(queueName);
      if (!msg) {
        console.log(`[Cron] Queue ${queueName} is empty`);
      }
      while (msg) {
        const data = JSON.parse(msg.content.toString());
        const eventType = msg.fields.routingKey;
        console.log(`[Cron] Dequeued ${eventType} from ${queueName} | email: ${data.email || 'n/a'}`);
        await sendEmail(data.email, eventType, data);
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
        throw new Error(`RabbitMQ connection failed in production: ${error.message}`);
      }

      console.warn('[Cron] RabbitMQ unavailable, skipping notification queue drain:', error.message);
      return 0;
    }

    console.error('Cron job failed:', error);
    throw error;
  }
};

if (require.main === module) {
  processMessages()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { processMessages };

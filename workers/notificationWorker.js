const amqplib = require('amqplib');
const axios = require('axios');

const ONESIGNAL_API = 'https://onesignal.com/api/v1/notifications';
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

const notificationTemplates = {
  'auth.signup': {
    title: 'Welcome!',
    message: 'Your account has been created successfully.',
  },
  'auth.login': {
    title: 'Login Successful',
    message: 'You have logged in to your account.',
  },
  'auth.logout': {
    title: 'Logged Out',
    message: 'You have been logged out.',
  },
  'payment.initialized': {
    title: 'Payment Started',
    message: 'Your payment process has started.',
  },
  'payment.verified': {
    title: 'Payment Verified',
    message: 'Your payment has been verified.',
  },
  'payment.success': {
    title: 'Payment Successful',
    message: 'Your payment was completed successfully.',
  },
  'payment.closed': {
    title: 'Payment Cancelled',
    message: 'Your payment process was cancelled.',
  },
};

const sendNotification = async (userId, email, eventType, data) => {
  try {
    const template = notificationTemplates[eventType];
    if (!template) return;

    await axios.post(ONESIGNAL_API, {
      app_id: ONESIGNAL_APP_ID,
      include_external_user_ids: [userId],
      include_email_tokens: [email],
      headings: { en: template.title },
      contents: { en: template.message },
      channels: ['email'],
      data: { eventType, ...data },
    }, {
      headers: { Authorization: `Basic ${ONESIGNAL_API_KEY}` },
    });

    console.log(`Email notification sent for ${eventType} to ${email}`);
  } catch (error) {
    console.error('Failed to send notification:', error.message);
  }
};

const startWorker = async () => {
  try {
    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange('auth_events', 'topic', { durable: true });
    await channel.assertExchange('payment_events', 'topic', { durable: true });

    const authQueue = await channel.assertQueue('auth_notifications', { durable: true });
    const paymentQueue = await channel.assertQueue('payment_notifications', { durable: true });

    await channel.bindQueue(authQueue.queue, 'auth_events', 'auth.*');
    await channel.bindQueue(paymentQueue.queue, 'payment_events', 'payment.*');

    channel.consume(authQueue.queue, async (msg) => {
      if (msg) {
        const data = JSON.parse(msg.content.toString());
        const eventType = msg.fields.routingKey;
        await sendNotification(data.userId, data.email, eventType, data);
        channel.ack(msg);
      }
    });

    channel.consume(paymentQueue.queue, async (msg) => {
      if (msg) {
        const data = JSON.parse(msg.content.toString());
        const eventType = msg.fields.routingKey;
        await sendNotification(data.userId, data.email, eventType, data);
        channel.ack(msg);
      }
    });

    console.log('Notification worker started');
  } catch (error) {
    console.error('Worker failed:', error);
    setTimeout(startWorker, 5000);
  }
};

startWorker();

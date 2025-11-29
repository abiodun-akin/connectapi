const amqplib = require('amqplib');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const senderEmail = process.env.RESEND_FROM_EMAIL || 'noreply@farmconnect.com';

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
};

const sendEmail = async (email, eventType, data) => {
  try {
    const template = emailTemplates[eventType];
    if (!template) return;

    await resend.emails.send({
      from: senderEmail,
      to: email,
      subject: template.subject,
      html: template.html,
    });

    console.log(`Email sent for ${eventType} to ${email}`);
  } catch (error) {
    console.error('Failed to send email:', error.message);
  }
};

const processMessages = async () => {
  try {
    const connection = await amqplib.connect(process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    await channel.assertExchange('auth_events', 'topic', { durable: true });
    await channel.assertExchange('payment_events', 'topic', { durable: true });

    const authQueue = await channel.assertQueue('auth_notifications', { durable: true });
    const paymentQueue = await channel.assertQueue('payment_notifications', { durable: true });

    await channel.bindQueue(authQueue.queue, 'auth_events', 'auth.*');
    await channel.bindQueue(paymentQueue.queue, 'payment_events', 'payment.*');

    let processed = 0;

    let msg = await channel.get(authQueue.queue);
    while (msg) {
      const data = JSON.parse(msg.content.toString());
      const eventType = msg.fields.routingKey;
      await sendEmail(data.email, eventType, data);
      channel.ack(msg);
      processed++;
      msg = await channel.get(authQueue.queue);
    }

    msg = await channel.get(paymentQueue.queue);
    while (msg) {
      const data = JSON.parse(msg.content.toString());
      const eventType = msg.fields.routingKey;
      await sendEmail(data.email, eventType, data);
      channel.ack(msg);
      processed++;
      msg = await channel.get(paymentQueue.queue);
    }

    console.log(`Processed ${processed} messages`);
    await connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Cron job failed:', error);
    process.exit(1);
  }
};

processMessages();

const amqplib = require('amqplib');

let connection = null;
let channel = null;

const initializeRabbitMQ = async () => {
  if (!process.env.RABBITMQ_URL) {
    console.warn('[RabbitMQ] RABBITMQ_URL not set — event publishing disabled');
    return;
  }
  try {
    console.log('[RabbitMQ] Connecting...');
    connection = await amqplib.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange('auth_events', 'topic', { durable: true });
    await channel.assertExchange('payment_events', 'topic', { durable: true });
    await channel.assertExchange('trial_events', 'topic', { durable: true });
    console.log('[RabbitMQ] Connected and exchanges asserted');
  } catch (error) {
    console.error('[RabbitMQ] Connection failed:', error.message);
    channel = null;
    connection = null;
    setTimeout(initializeRabbitMQ, 5000);
  }
};

const publishEvent = async (exchange, eventType, data) => {
  try {
    if (!process.env.RABBITMQ_URL) {
      console.warn(`[RabbitMQ] Skipping publish for ${eventType} — RABBITMQ_URL not set`);
      return;
    }
    if (!channel) {
      console.warn(`[RabbitMQ] Channel not ready for ${eventType}, attempting reconnect...`);
      await initializeRabbitMQ();
    }
    if (!channel) {
      console.error(`[RabbitMQ] Channel unavailable — could not publish ${eventType}`);
      return;
    }
    const payload = JSON.stringify(data);
    channel.publish(exchange, eventType, Buffer.from(payload));
    console.log(`[RabbitMQ] Published ${eventType} to exchange ${exchange} | email: ${data.email || 'n/a'} | payload: ${payload}`);
  } catch (error) {
    console.error(`[RabbitMQ] Failed to publish ${eventType}:`, error.message);
  }
};

const eventNotificationMiddleware = (req, res, next) => {
  res.publishEvent = (exchange, eventType, data) => {
    publishEvent(exchange, eventType, data);
  };
  next();
};

module.exports = { initializeRabbitMQ, publishEvent, eventNotificationMiddleware };

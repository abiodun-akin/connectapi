const amqplib = require('amqplib');

let connection = null;
let channel = null;

const initializeRabbitMQ = async () => {
  try {
    connection = await amqplib.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertExchange('auth_events', 'topic', { durable: true });
    await channel.assertExchange('payment_events', 'topic', { durable: true });
    console.log('RabbitMQ connected');
  } catch (error) {
    console.error('RabbitMQ connection failed:', error);
    setTimeout(initializeRabbitMQ, 5000);
  }
};

const publishEvent = async (exchange, eventType, data) => {
  try {
    if (!channel) await initializeRabbitMQ();
    channel.publish(exchange, eventType, Buffer.from(JSON.stringify(data)));
    console.log(`Event published: ${eventType}`, data);
  } catch (error) {
    console.error('Failed to publish event:', error);
  }
};

const eventNotificationMiddleware = (req, res, next) => {
  res.publishEvent = (exchange, eventType, data) => {
    publishEvent(exchange, eventType, data);
  };
  next();
};

module.exports = { initializeRabbitMQ, publishEvent, eventNotificationMiddleware };

/**
 * Jest Setup File
 * Global configuration for backend tests
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://localhost:27017/farmconnect-test';
process.env.JWT_SECRET = 'test-secret-key';
process.env.PAYSTACK_SECRET = 'test-paystack-secret';

// Global test timeout
jest.setTimeout(10000);

// Suppress console output in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Cleanup database connections after all tests
afterAll(async () => {
  // Add any cleanup logic here
  jest.clearAllTimers();
});

// Mock external services
jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue({
    createChannel: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ id: 'test-email-id' }),
    },
  })),
}));

// Custom matchers for API testing
expect.extend({
  toBeValidEmail(received) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);
    return {
      pass,
      message: () => `expected ${received} to be a valid email`,
    };
  },
  toBeValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/;
    const pass = jwtRegex.test(received);
    return {
      pass,
      message: () => `expected ${received} to be a valid JWT token`,
    };
  },
});

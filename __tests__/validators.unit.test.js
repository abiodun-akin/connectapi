/**
 * Input Validators Unit Tests
 * Tests for input validation rules
 */

const { validationRules, validateRequest, createValidationSchema } = require('../validators/inputValidator');
const { ValidationError } = require('../errors/AppError');

describe('Input Validators', () => {
  describe('Email Validation', () => {
    it('should validate correct email format', () => {
      const validEmails = [
        'user@example.com',
        'john.doe@company.co.uk',
        'test+tag@example.com',
      ];

      validEmails.forEach((email) => {
        expect(() => validationRules.email(email)).not.toThrow();
      });
    });

    it('should reject invalid email format', () => {
      const invalidEmails = [
        'invalid-email',
        'user@',
        '@example.com',
        'user@.com',
      ];

      invalidEmails.forEach((email) => {
        expect(() => validationRules.email(email)).toThrow(ValidationError);
      });
    });

    it('should reject empty/null emails', () => {
      expect(() => validationRules.email('')).toThrow(ValidationError);
      expect(() => validationRules.email(null)).toThrow(ValidationError);
    });
  });

  describe('Password Validation', () => {
    it('should validate strong passwords', () => {
      const strongPasswords = [
        'SecurePassword123',
        'MyP@ssw0rd',
        'Test@Pass123',
      ];

      strongPasswords.forEach((password) => {
        expect(() => validationRules.password(password)).not.toThrow();
      });
    });

    it('should require minimum length of 8 characters', () => {
      expect(() => validationRules.password('Short1a')).toThrow(ValidationError);
    });

    it('should require at least one uppercase letter', () => {
      expect(() => validationRules.password('lowercase123')).toThrow(ValidationError);
    });

    it('should require at least one number', () => {
      expect(() => validationRules.password('NoNumbers')).toThrow(ValidationError);
    });
  });

  describe('Name Validation', () => {
    it('should validate correct names', () => {
      const validNames = [
        'John Doe',
        'Mary Jane Watson',
        'Ahmed Hassan',
      ];

      validNames.forEach((name) => {
        expect(() => validationRules.name(name)).not.toThrow();
      });
    });

    it('should reject invalid names', () => {
      const invalidNames = [
        'J',
        '123456',
        '@#$%',
      ];

      invalidNames.forEach((name) => {
        expect(() => validationRules.name(name)).toThrow(ValidationError);
      });
    });

    it('should require minimum length of 2 characters', () => {
      expect(() => validationRules.name('A')).toThrow(ValidationError);
    });
  });

  describe('Title Validation', () => {
    it('should validate correct titles', () => {
      const validTitles = [
        'Organic Vegetables',
        'Fresh Farm Produce',
        'Premium Quality Seeds',
      ];

      validTitles.forEach((title) => {
        expect(() => validationRules.title(title)).not.toThrow();
      });
    });

    it('should reject titles that are too short', () => {
      expect(() => validationRules.title('AB')).toThrow(ValidationError);
    });

    it('should reject titles that are too long', () => {
      const longTitle = 'a'.repeat(201);
      expect(() => validationRules.title(longTitle)).toThrow(ValidationError);
    });
  });

  describe('Amount Validation', () => {
    it('should validate positive amounts', () => {
      expect(() => validationRules.amount(100)).not.toThrow();
      expect(() => validationRules.amount(99.99)).not.toThrow();
      expect(() => validationRules.amount('50.50')).not.toThrow();
    });

    it('should reject zero or negative amounts', () => {
      expect(() => validationRules.amount(0)).toThrow(ValidationError);
      expect(() => validationRules.amount(-50)).toThrow(ValidationError);
    });

    it('should reject undefined amounts', () => {
      expect(() => validationRules.amount(undefined)).toThrow(ValidationError);
    });
  });

  describe('Plan Validation', () => {
    it('should validate valid plan types', () => {
      expect(() => validationRules.plan('basic')).not.toThrow();
      expect(() => validationRules.plan('premium')).not.toThrow();
      expect(() => validationRules.plan('enterprise')).not.toThrow();
    });

    it('should reject invalid plan types', () => {
      expect(() => validationRules.plan('invalid')).toThrow(ValidationError);
      expect(() => validationRules.plan('trial')).toThrow(ValidationError);
    });

    it('should be case insensitive', () => {
      expect(() => validationRules.plan('BASIC')).not.toThrow();
      expect(() => validationRules.plan('Premium')).not.toThrow();
    });
  });

  describe('Reference Validation', () => {
    it('should validate valid payment references', () => {
      expect(() => validationRules.reference('ref12345')).not.toThrow();
      expect(() => validationRules.reference('PAYSTACK_ABC123')).not.toThrow();
    });

    it('should reject short references', () => {
      expect(() => validationRules.reference('ref')).toThrow(ValidationError);
    });
  });

  describe('Validation Schema Creation', () => {
    it('should create schema with specified fields', () => {
      const schema = createValidationSchema('email', 'password', 'name');
      expect(schema).toHaveProperty('email');
      expect(schema).toHaveProperty('password');
      expect(schema).toHaveProperty('name');
      expect(typeof schema.email).toBe('function');
    });

    it('should ignore non-existent fields', () => {
      const schema = createValidationSchema('email', 'nonexistent');
      expect(schema).toHaveProperty('email');
      expect(schema).not.toHaveProperty('nonexistent');    });
  });
});
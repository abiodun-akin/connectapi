/**
 * Input validation utilities
 */
const validator = require('validator');
const { ValidationError } = require('../errors/AppError');

/**
 * Validation rules for different fields
 */
const validationRules = {
  email: (email) => {
    if (!email || typeof email !== 'string') {
      throw new ValidationError('Email is required', 'email');
    }
    if (!validator.isEmail(email)) {
      throw new ValidationError('Invalid email format', 'email');
    }
  },

  password: (password, minLength = 8) => {
    if (!password || typeof password !== 'string') {
      throw new ValidationError('Password is required', 'password');
    }
    if (password.length < minLength) {
      throw new ValidationError(
        `Password must be at least ${minLength} characters`,
        'password'
      );
    }
    if (!/[A-Z]/.test(password)) {
      throw new ValidationError(
        'Password must contain at least one uppercase letter',
        'password'
      );
    }
    if (!/[0-9]/.test(password)) {
      throw new ValidationError(
        'Password must contain at least one number',
        'password'
      );
    }
  },

  name: (name) => {
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Name is required', 'name');
    }
    if (name.trim().length < 2) {
      throw new ValidationError('Name must be at least 2 characters', 'name');
    }
    if (!/^[A-Za-z]+([ '-][A-Za-z]+)*$/.test(name)) {
      throw new ValidationError(
        'Name contains invalid characters',
        'name'
      );
    }
  },

  title: (title) => {
    if (!title || typeof title !== 'string') {
      throw new ValidationError('Title is required', 'title');
    }
    if (title.trim().length < 3) {
      throw new ValidationError('Title must be at least 3 characters', 'title');
    }
    if (title.length > 200) {
      throw new ValidationError('Title must not exceed 200 characters', 'title');
    }
  },

  location: (location) => {
    if (!location || typeof location !== 'string') {
      throw new ValidationError('Location is required', 'location');
    }
    if (location.trim().length < 2) {
      throw new ValidationError(
        'Location must be at least 2 characters',
        'location'
      );
    }
  },

  description: (description) => {
    if (!description || typeof description !== 'string') {
      throw new ValidationError('Description is required', 'description');
    }
    if (description.trim().length < 10) {
      throw new ValidationError(
        'Description must be at least 10 characters',
        'description'
      );
    }
    if (description.length > 5000) {
      throw new ValidationError(
        'Description must not exceed 5000 characters',
        'description'
      );
    }
  },

  mongoId: (id, fieldName = 'ID') => {
    if (!validator.isMongoId(id)) {
      throw new ValidationError(`Invalid ${fieldName}`, fieldName);
    }
  },

  amount: (amount) => {
    if (amount === undefined || amount === null) {
      throw new ValidationError('Amount is required', 'amount');
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      throw new ValidationError('Amount must be a positive number', 'amount');
    }
  },

  plan: (plan) => {
    const validPlans = ['basic', 'premium', 'enterprise'];
    if (!plan || !validPlans.includes(plan.toLowerCase())) {
      throw new ValidationError(
        `Plan must be one of: ${validPlans.join(', ')}`,
        'plan'
      );
    }
  },
};

/**
 * Middleware wrapper for validating request body
 * @param {Object} schema - Object with field names as keys and validator functions as values
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    try {
      const data = req.body || {};

      // Run all validators
      Object.entries(schema).forEach(([field, validator]) => {
        if (typeof validator === 'function') {
          validator(data[field]);
        }
      });

      next();
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          field: error.field,
        });
      }
      next(error);
    }
  };
};

/**
 * Helper to create validation schema
 */
const createValidationSchema = (...fields) => {
  const schema = {};
  fields.forEach((field) => {
    if (validationRules[field]) {
      schema[field] = validationRules[field];
    }
  });
  return schema;
};

module.exports = {
  validationRules,
  validateRequest,
  createValidationSchema,
};

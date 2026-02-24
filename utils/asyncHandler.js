/**
 * Async error wrapper for Express route handlers
 * Automatically catches errors thrown in async functions and passes them to next(err)
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = asyncHandler;

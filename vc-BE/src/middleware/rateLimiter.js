const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for API routes: 100 requests per 15 minutes per IP.
 * @returns {import('express-rate-limit').RateLimitRequestHandler}
 */
function createApiRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many login attempts. Try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    error: 'Too many token requests. Try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const roomCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    error: 'Too many rooms created. Try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  createApiRateLimiter,
  loginLimiter,
  tokenLimiter,
  roomCreationLimiter,
};

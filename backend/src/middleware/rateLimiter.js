import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

// Every limiter answers with the API's standard error shape and HTTP 429
export function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          details: {},
          requestId: req.id || 'unknown',
        },
      });
    },
  });
}

// Limits are relaxed under test so the suite can log in many times; the factory above is tested directly
export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 10, // 10 attempts per IP per 15 min
  message: 'Too many login attempts. Please try again after 15 minutes.',
});

export const apiLimiter = createLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isTest ? 5000 : 120, // 120 requests per minute
  message: 'Too many requests. Please slow down.',
});

export default {
  loginLimiter,
  apiLimiter,
  createLimiter,
};

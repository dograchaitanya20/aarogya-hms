import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 10, // 10 attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many login attempts. Please try again after 15 minutes.',
        details: {},
        requestId: req.id || 'unknown',
      },
    });
  },
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: isTest ? 5000 : 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please slow down.',
        details: {},
        requestId: req.id || 'unknown',
      },
    });
  },
});

export default {
  loginLimiter,
  apiLimiter,
};

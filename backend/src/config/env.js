import dotenv from 'dotenv';

dotenv.config();

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = parseInt(process.env.PORT || '5000', 10);
export const HOSPITAL_TZ = process.env.HOSPITAL_TZ || 'Asia/Kolkata';

// In production, JWT_SECRET is strictly mandatory with zero fallback
if (NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
    throw new Error('FATAL: JWT_SECRET must be set and at least 32 characters long in production.');
  }
}

export const JWT_SECRET =
  process.env.JWT_SECRET || 'dev-jwt-super-secret-key-change-in-production-min-32-chars';

// Enforce JWT expiry <= 8 hours
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export const BCRYPT_SALT_ROUNDS = 10;

export default {
  NODE_ENV,
  PORT,
  HOSPITAL_TZ,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  FRONTEND_URL,
  BCRYPT_SALT_ROUNDS,
};

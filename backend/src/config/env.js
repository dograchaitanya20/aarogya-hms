import dotenv from 'dotenv';
import path from 'path';

// Load .env from current directory or parent directory
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = parseInt(process.env.PORT || '5000', 10);
export const HOSPITAL_TZ = process.env.HOSPITAL_TZ || 'Asia/Kolkata';

// Duration parser helper
export function parseDurationToSeconds(durationStr) {
  if (typeof durationStr === 'number') return durationStr;
  const match = String(durationStr || '').trim().match(/^(\d+)([smhd])$/);
  if (!match) return NaN;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return num;
    case 'm': return num * 60;
    case 'h': return num * 3600;
    case 'd': return num * 86400;
    default: return NaN;
  }
}

// Validation function so it can also be tested explicitly in unit tests
export function validateEnv(env = process.env) {
  const isTest = env.NODE_ENV === 'test';

  // 1. JWT_SECRET: strictly required outside tests (no hardcoded fallback in dev or prod)
  if (!isTest) {
    if (!env.JWT_SECRET || env.JWT_SECRET.trim().length < 32) {
      throw new Error(
        'FATAL: JWT_SECRET must be set and at least 32 characters long. Set it in .env (see .env.example).'
      );
    }
  }

  // 2. JWT_EXPIRES_IN: must not exceed 8 hours
  const expiryStr = env.JWT_EXPIRES_IN || '8h';
  const seconds = parseDurationToSeconds(expiryStr);
  if (isNaN(seconds) || seconds <= 0 || seconds > 8 * 3600) {
    throw new Error(
      `FATAL: JWT_EXPIRES_IN must not exceed 8 hours (received '${expiryStr}'). Configure 8h or less.`
    );
  }

  return {
    jwtSecret: isTest ? (env.JWT_SECRET || 'test-jwt-super-secret-key-min-32-chars-long') : env.JWT_SECRET,
    jwtExpiresIn: expiryStr,
  };
}

const validated = validateEnv(process.env);

export const JWT_SECRET = validated.jwtSecret;
export const JWT_EXPIRES_IN = validated.jwtExpiresIn;
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
  parseDurationToSeconds,
  validateEnv,
};

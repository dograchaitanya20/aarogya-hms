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
  if (!durationStr) return 0;
  const str = String(durationStr).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const match = str.match(/^(\d+)([smhd])$/);
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
  // 1. JWT_SECRET: required and >= 32 chars in EVERY environment. There is no fallback value anywhere in
  // source; tests receive theirs from vitest.config.js and CI from the workflow env.
  if (!env.JWT_SECRET || env.JWT_SECRET.trim().length < 32) {
    throw new Error(
      'FATAL: JWT_SECRET must be set and at least 32 characters long. Set it in .env (see .env.example).'
    );
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
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: expiryStr,
  };
}

const validated = validateEnv(process.env);

export const JWT_SECRET = validated.jwtSecret;
export const JWT_EXPIRES_IN = validated.jwtExpiresIn;
// Cookie signing secret: falls back to JWT_SECRET (never to a literal in source)
export const COOKIE_SECRET = process.env.COOKIE_SECRET || validated.jwtSecret;
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

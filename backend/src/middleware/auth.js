import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../errors/AppError.js';
import userRepository from '../repositories/userRepository.js';
import { JWT_SECRET } from '../config/env.js';

export async function requireAuth(req, res, next) {
  try {
    let token = null;

    // Check httpOnly cookie first, then fallback to Authorization header
    if (req.cookies && req.cookies.aarogya_token) {
      token = req.cookies.aarogya_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new UnauthorizedError('Authentication token missing. Please log in.');
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      throw new UnauthorizedError('Invalid or expired authentication session. Please log in again.');
    }

    const user = await userRepository.findById(decoded.id);
    if (!user || !user.is_active) {
      throw new UnauthorizedError('User account not found or deactivated.');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export default requireAuth;

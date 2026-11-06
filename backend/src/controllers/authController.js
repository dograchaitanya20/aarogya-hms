import { z } from 'zod';
import authService from '../services/authService.js';

const loginSchema = z.object({
  email: z.string().email('Valid email address required'),
  password: z.string().min(1, 'Password is required'),
});

const isProd = process.env.NODE_ENV === 'production';

export async function login(req, res, next) {
  try {
    const validatedData = loginSchema.parse(req.body);

    const result = await authService.login({
      email: validatedData.email,
      password: validatedData.password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });

    // Set secure httpOnly cookie
    res.cookie('aarogya_token', result.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    res.status(200).json({
      message: 'Authentication successful',
      token: result.token, // Also return token for API / bearer clients
      user: result.user,
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    await authService.logout({
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
    });

    res.clearCookie('aarogya_token', {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
    });

    res.status(200).json({
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await authService.getMe(req.user.id);
    res.status(200).json({
      user,
    });
  } catch (err) {
    next(err);
  }
}

export default {
  login,
  logout,
  getMe,
};

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import userRepository from '../repositories/userRepository.js';
import auditService from './auditService.js';
import { UnauthorizedError } from '../errors/AppError.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-super-secret-key-change-in-production-min-32-chars';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

export async function login({ email, password, ipAddress, userAgent, requestId }) {
  const user = await userRepository.findByEmail(email);

  if (!user) {
    await auditService.logAuthEvent({
      action: 'LOGIN_FAILURE',
      email,
      ipAddress,
      userAgent,
      requestId,
      details: { reason: 'User not found' },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    await auditService.logAuthEvent({
      action: 'LOGIN_FAILURE',
      email,
      actorId: user.id,
      actorRole: user.role,
      ipAddress,
      userAgent,
      requestId,
      details: { reason: 'Incorrect password' },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Generate JWT Token
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // Audit successful login
  await auditService.logAuthEvent({
    action: 'LOGIN_SUCCESS',
    email: user.email,
    actorId: user.id,
    actorRole: user.role,
    ipAddress,
    userAgent,
    requestId,
  });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      phone: user.phone,
      doctorId: user.doctor_id || null,
      departmentId: user.department_id || null,
      specialization: user.specialization || null,
      roomNumber: user.room_number || null,
    },
  };
}

export async function logout({ user, ipAddress, userAgent, requestId }) {
  if (user) {
    await auditService.logAuthEvent({
      action: 'LOGOUT',
      email: user.email,
      actorId: user.id,
      actorRole: user.role,
      ipAddress,
      userAgent,
      requestId,
    });
  }

  return { message: 'Successfully logged out' };
}

export async function getMe(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    throw new UnauthorizedError('User session expired or user not found');
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    phone: user.phone,
    doctorId: user.doctor_id || null,
    departmentId: user.department_id || null,
    departmentName: user.department_name || null,
    departmentCode: user.department_code || null,
    specialization: user.specialization || null,
    consultationFeePaise: user.consultation_fee_paise || null,
    roomNumber: user.room_number || null,
  };
}

export default {
  login,
  logout,
  getMe,
};

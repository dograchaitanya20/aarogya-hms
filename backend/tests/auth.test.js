import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { loginAs } from './helpers.js';

describe('Health & Authentication Endpoints', () => {
  describe('GET /api/v1/health', () => {
    it('should return 200 OK with connected database status', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database.status).toBe('connected');
      expect(res.headers['x-request-id']).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should successfully authenticate user with valid credentials and set httpOnly cookie', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@aarogya.local',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('admin@aarogya.local');
      expect(res.body.user.role).toBe('admin');
      expect(res.body.token).toBeDefined();

      // Check cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = cookies.find((c) => c.startsWith('aarogya_token='));
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');

      // Verify audit log recorded LOGIN_SUCCESS
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'LOGIN_SUCCESS' AND entity_id = 'admin@aarogya.local' ORDER BY ts DESC LIMIT 1;`
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('should return 401 UNAUTHORIZED on wrong password and write audit log', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@aarogya.local',
          password: 'WrongPassword999!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.requestId).toBeDefined();

      // Non-negotiable: Audit entry written on login failure
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'LOGIN_FAILURE' AND entity_id = 'admin@aarogya.local' ORDER BY ts DESC LIMIT 1;`
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].after_state.reason).toBe('Incorrect password');
    });

    it('should return 401 UNAUTHORIZED for non-existent email and write audit log', async () => {
      const nonExistentEmail = 'ghost@aarogya.local';
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: nonExistentEmail,
          password: 'AnyPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');

      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'LOGIN_FAILURE' AND entity_id = $1 ORDER BY ts DESC LIMIT 1;`,
        [nonExistentEmail]
      );
      expect(auditRes.rows.length).toBe(1);
    });

    it('should return 422 VALIDATION_ERROR for malformed request body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: '',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.email).toBeDefined();
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return user profile when authenticated with cookie', async () => {
      const auth = await loginAs('frontdesk1@aarogya.local');
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', auth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('frontdesk1@aarogya.local');
      expect(res.body.user.role).toBe('front_desk');
    });

    it('should return 401 UNAUTHORIZED when no token or cookie provided', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 UNAUTHORIZED when given a malformed or forged JWT token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toContain('Invalid or expired authentication session');
    });

    it('should reject login and me endpoints if user is marked inactive (is_active = false)', async () => {
      // 1. Create temporary inactive user
      const inactiveEmail = 'inactive.test@aarogya.local';
      await query(
        `
        INSERT INTO users (email, password_hash, role, full_name, is_active)
        VALUES ($1, '$2b$10$wTqS4hV5y4u5MmsrKzP53uN4W1K0y2s2R8Y0h1jK3y5l2m1n0o9p.', 'front_desk', 'Inactive Staff', false)
        ON CONFLICT (email) DO UPDATE SET is_active = false;
        `,
        [inactiveEmail]
      );

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: inactiveEmail,
          password: 'Password123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should successfully clear cookie and audit logout', async () => {
      const auth = await loginAs('frontdesk2@aarogya.local');
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', auth.cookie);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Logged out');

      // Verify cookie cleared
      const cookies = res.headers['set-cookie'];
      expect(cookies[0]).toMatch(/aarogya_token=;/);

      // Verify logout audit
      const auditRes = await query(
        `SELECT * FROM audit_log WHERE action = 'LOGOUT' AND entity_id = 'frontdesk2@aarogya.local' ORDER BY ts DESC LIMIT 1;`
      );
      expect(auditRes.rows.length).toBe(1);
    });
  });
});

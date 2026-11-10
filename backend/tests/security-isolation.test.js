import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import pg from 'pg';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { createLimiter } from '../src/middleware/rateLimiter.js';
import patientRepository from '../src/repositories/patientRepository.js';
import { loginAs } from './helpers.js';

describe('Security Hardening & Test DB Isolation Checks', () => {
  describe('A2: Test Database Isolation Proof', () => {
    it('proves tests run against aarogya_hms_test, NOT the development database aarogya_hms', async () => {
      // 1. The connection the whole suite uses is the isolated test database
      const currentDbRes = await query('SELECT current_database();');
      expect(currentDbRes.rows[0].current_database).toBe('aarogya_hms_test');

      // 2. A row written through that connection exists in the test database
      const testMrn = `ISOLATION-TEST-${Date.now()}`;
      await query(
        `INSERT INTO patients (mrn, full_name, date_of_birth, gender, phone)
         VALUES ($1, 'Isolation Patient', '1995-01-01', 'other', '+91 9999911111')
         ON CONFLICT DO NOTHING;`,
        [testMrn]
      );
      const testCheck = await query('SELECT 1 FROM patients WHERE mrn = $1', [testMrn]);
      expect(testCheck.rows.length).toBe(1);

      // 3. ...and is absent from the development database. The dev database only exists on a developer
      // machine (CI provisions the test database alone), so when it does not exist this comparison
      // is skipped; steps 1 and 2 above are the isolation proof that always runs.
      const devUrl = process.env.TEST_DATABASE_URL.replace(/aarogya_hms_test$/, 'aarogya_hms');
      const devPool = new pg.Pool({ connectionString: devUrl });
      try {
        let devCheck = null;
        try {
          devCheck = await devPool.query('SELECT 1 FROM patients WHERE mrn = $1', [testMrn]);
        } catch (err) {
          if (err.code !== '3D000') throw err; // 3D000 = database does not exist (e.g. CI)
        }
        if (devCheck) {
          expect(devCheck.rows.length).toBe(0);
        }
      } finally {
        await devPool.end();
        await query('DELETE FROM patients WHERE mrn = $1', [testMrn]);
      }
    });
  });

  describe('A3: Security Hardening Checks', () => {
    it('enforces JSON body size limit (rejects payload > 100kb with 413)', async () => {
      const largePayload = { data: 'X'.repeat(120 * 1024) }; // 120 KB
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(largePayload);

      expect(res.status).toBe(413);
    });

    it('forced internal and database errors return a generic 500: no stack trace, SQL, file paths or error message', async () => {
      const admin = await loginAs('admin@aarogya.local');
      const leakyMessage = 'relation "patients" does not exist: SELECT password_hash FROM users WHERE id = 42';
      const dbError = Object.assign(new Error(leakyMessage), {
        code: '42P01',
        stack: 'Error: boom\n    at Object.query (/srv/app/backend/src/config/db.js:12:5)',
        detail: 'Key (id)=(secret) is not present',
        query: 'SELECT password_hash FROM users',
      });
      const plainError = new Error('Internal secret: JWT_SECRET=abc123');

      for (const failure of [dbError, plainError]) {
        const spy = vi.spyOn(patientRepository, 'getPatients').mockRejectedValueOnce(failure);
        const res = await request(app).get('/api/v1/patients').set('Cookie', admin.cookie);
        spy.mockRestore();

        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(res.body.error.requestId).toBeTruthy();
        const raw = JSON.stringify(res.body);
        for (const forbidden of ['SELECT', 'password_hash', 'JWT_SECRET', 'abc123', 'stack', '.js:', '/srv/app', 'does not exist', 'secret']) {
          expect(raw, `response leaked "${forbidden}"`).not.toContain(forbidden);
        }
      }
    });

    it('validates bcrypt hash cost is >= 10', async () => {
      const userRes = await query("SELECT password_hash FROM users WHERE email = 'admin@aarogya.local' LIMIT 1;");
      const hash = userRes.rows[0].password_hash;
      // bcrypt hashes are in format $2b$[cost]$[salt+hash]
      const parts = hash.split('$');
      const cost = parseInt(parts[2], 10);
      expect(cost).toBeGreaterThanOrEqual(10);
    });

    it('the limiter really returns 429 in the standard error format once the limit is exceeded', async () => {
      // A tiny app using the SAME factory that builds loginLimiter/apiLimiter (limit 3 per window)
      const mini = express();
      mini.use((req, res, next) => {
        req.id = 'req-from-test';
        next();
      });
      mini.use(createLimiter({ windowMs: 60_000, max: 3, message: 'Too many login attempts. Slow down.' }));
      mini.get('/ping', (req, res) => res.json({ ok: true }));

      const statuses = [];
      let blocked;
      for (let i = 0; i < 5; i++) {
        const res = await request(mini).get('/ping');
        statuses.push(res.status);
        if (res.status === 429) blocked = res;
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      expect(blocked.body).toEqual({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many login attempts. Slow down.',
          details: {},
          requestId: 'req-from-test',
        },
      });
    });

    it('the real login route is actually behind the limiter (rate-limit headers present)', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@aarogya.local', password: 'x' });
      expect(res.status).toBe(401);
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(Number(res.headers['ratelimit-remaining'])).toBeGreaterThanOrEqual(0);
    });

    it('newly created staff accounts are hashed with bcrypt cost >= 10 and the hash is never returned', async () => {
      const admin = await loginAs('admin@aarogya.local');
      const email = `bcrypt.check.${Date.now()}@aarogya.local`;
      const res = await request(app)
        .post('/api/v1/directory/staff')
        .set('Cookie', admin.cookie)
        .send({ email, password: 'Password123!', fullName: 'Bcrypt Check', phone: '+91 9888888888', role: 'front_desk' });
      expect(res.status).toBe(201);
      expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/i);

      const row = await query('SELECT password_hash FROM users WHERE email = $1', [email]);
      expect(row.rows[0].password_hash).not.toContain('Password123!');
      expect(parseInt(row.rows[0].password_hash.split('$')[2], 10)).toBeGreaterThanOrEqual(10);
    });
  });
});
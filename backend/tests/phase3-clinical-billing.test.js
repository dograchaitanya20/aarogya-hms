import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import auditService from '../src/services/auditService.js';
import { query } from '../src/config/db.js';
import { loginAs, getTestDoctorAndPatients, deleteAppointmentsWhere } from './helpers.js';

// Everything here runs against the real (isolated) test database. No mocks.
describe('Phase 3: encounters, clinical records, billing, reports, audit viewer', () => {
  let admin;
  let frontDesk;
  let clinician1; // treats the test patients
  let clinician2; // treats nobody in this suite
  let doctor1;
  let doctor2;
  let adminUser;
  let frontDeskUser;
  const createdPatientIds = [];
  const RUN = Date.now();
  let slotCounter = 0;
  const baseMs = Date.UTC(2031, 5, 1) + Math.floor(Math.random() * 200) * 86400000;

  const tag = (s) => `P3-${RUN}-${s}`;

  async function newPatient(name = 'P3 Test Patient') {
    const res = await query(
      `INSERT INTO patients (full_name, date_of_birth, gender, phone)
       VALUES ($1, '1990-01-01', 'female', '+91 9000000000') RETURNING *`,
      [`${name} ${tag(createdPatientIds.length)}`]
    );
    createdPatientIds.push(res.rows[0].id);
    return res.rows[0];
  }

  // Inserts an appointment directly (so the clinical/billing tests do not depend on the booking rules)
  async function newAppointment({ doctor = doctor1, patient, status = 'scheduled' }) {
    const startsAt = new Date(baseMs + slotCounter * 30 * 60000);
    const endsAt = new Date(startsAt.getTime() + 15 * 60000);
    slotCounter += 1;
    const res = await query(
      `INSERT INTO appointments (patient_id, doctor_id, department_id, starts_at, ends_at, status, reason_for_visit, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [patient.id, doctor.id, doctor.department_id, startsAt, endsAt, status, tag('visit'), frontDeskUser.id]
    );
    return res.rows[0];
  }

  const setStatus = (auth, id, status, extra = {}) =>
    request(app).patch(`/api/v1/appointments/${id}/status`).set('Cookie', auth.cookie).send({ status, ...extra });

  // Drives an appointment through the real API to in_consultation, returning the encounter row
  async function startConsultation(appointment) {
    expect((await setStatus(frontDesk, appointment.id, 'checked_in')).status).toBe(200);
    expect((await setStatus(clinician1, appointment.id, 'in_consultation')).status).toBe(200);
    const enc = await query('SELECT * FROM encounters WHERE appointment_id = $1', [appointment.id]);
    return enc.rows[0];
  }

  const post = (path, auth, body, key) => {
    const r = request(app).post(`/api/v1${path}`).set('Cookie', auth.cookie);
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  };
  const get = (path, auth) => request(app).get(`/api/v1${path}`).set('Cookie', auth.cookie);

  async function newInvoice({ patient, appointmentId, items, taxPaise = 0, discountPaise = 0 }) {
    const res = await post(
      '/billing/invoices',
      frontDesk,
      {
        patientId: patient.id,
        appointmentId,
        items: items || [{ description: 'Consultation', quantity: 1, unitPricePaise: 100000 }],
        taxPaise,
        discountPaise,
      },
      tag(`inv-${Math.random()}`)
    );
    expect(res.status).toBe(201);
    return res.body.data;
  }

  const pay = (invoiceId, body, key) =>
    post(`/billing/invoices/${invoiceId}/payments`, frontDesk, body, key || tag(`pay-${Math.random()}`));

  async function auditCount(action, entityId) {
    const res = await query(
      'SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND ($2::text IS NULL OR entity_id = $2)',
      [action, entityId || null]
    );
    return res.rows[0].n;
  }

    // Audit rows written for ONE request, matched by the requestId the API returned. Counting "all rows of
  // an action" is wrong here: vitest runs test files in parallel against the same database.
  async function auditForRequest(action, requestId) {
    const res = await query('SELECT COUNT(*)::int AS n FROM audit_log WHERE action = $1 AND request_id = $2', [action, requestId]);
    return res.rows[0].n;
  }

  beforeAll(async () => {
    const ctx = await getTestDoctorAndPatients();
    [doctor1, doctor2] = ctx.doctors;
    adminUser = ctx.admin;
    frontDeskUser = ctx.frontDesk;
    admin = await loginAs(ctx.admin.email);
    frontDesk = await loginAs(ctx.frontDesk.email);
    clinician1 = await loginAs(doctor1.email);
    clinician2 = await loginAs(doctor2.email);
  });

  afterAll(async () => {
    await deleteAppointmentsWhere('reason_for_visit LIKE $1', [`P3-${RUN}-%`]);
    if (createdPatientIds.length > 0) {
      await query(
        'DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE patient_id = ANY($1))',
        [createdPatientIds]
      );
      await query('DELETE FROM invoices WHERE patient_id = ANY($1)', [createdPatientIds]);
      await query('DELETE FROM diagnostic_reports WHERE patient_id = ANY($1)', [createdPatientIds]);
    }
  });

  // ---------------------------------------------------------------------------
  describe('Encounter lifecycle', () => {
    it('opens an encounter when the clinician starts the consultation and closes it on completion (with audit)', async () => {
      const patient = await newPatient();
      const appt = await newAppointment({ patient });
      const enc = await startConsultation(appt);

      expect(enc).toBeTruthy();
      expect(enc.status).toBe('in_progress');
      expect(enc.patient_id).toBe(patient.id);
      expect(enc.doctor_id).toBe(doctor1.id);
      expect(await auditCount('CREATE_ENCOUNTER', enc.id)).toBe(1);

      expect((await setStatus(clinician1, appt.id, 'completed')).status).toBe(200);
      const closed = await query('SELECT status, ended_at FROM encounters WHERE id = $1', [enc.id]);
      expect(closed.rows[0].status).toBe('completed');
      expect(closed.rows[0].ended_at).not.toBeNull();
    });

    it('never creates two encounters for the same appointment', async () => {
      const patient = await newPatient();
      const appt = await newAppointment({ patient });
      await startConsultation(appt);
      const n = await query('SELECT COUNT(*)::int AS n FROM encounters WHERE appointment_id = $1', [appt.id]);
      expect(n.rows[0].n).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Clinical notes, prescriptions, diagnostic reports', () => {
    let patient;
    let encounter;
    let appointment;
    const NOTE_MARKER = tag('CONFIDENTIAL-NOTE-TEXT');
    const MED_MARKER = tag('SecretMedicine');

    beforeAll(async () => {
      patient = await newPatient('Clinical Patient');
      appointment = await newAppointment({ patient });
      encounter = await startConsultation(appointment);
    });

    const noteBody = (extra = {}) => ({
      chiefComplaint: 'Chest discomfort on exertion',
      diagnosisNotes: NOTE_MARKER,
      ...extra,
    });

    it('clinician writes a note to their own open encounter, and the note TEXT never reaches the audit log', async () => {
      const res = await post(`/clinical/encounters/${encounter.id}/notes`, clinician1, noteBody());
      expect(res.status).toBe(201);
      expect(res.body.data.diagnosis_notes).toBe(NOTE_MARKER);

      expect(await auditCount('CREATE_CLINICAL_NOTE', res.body.data.id)).toBe(1);
      const leaked = await query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE COALESCE(before_state::text, '') LIKE $1 OR COALESCE(after_state::text, '') LIKE $1`,
        [`%${NOTE_MARKER}%`]
      );
      expect(leaked.rows[0].n).toBe(0);
    });

    it('rejects an incomplete note with 422 VALIDATION_ERROR', async () => {
      const res = await post(`/clinical/encounters/${encounter.id}/notes`, clinician1, {
        chiefComplaint: '',
        diagnosisNotes: 'x',
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('another clinician cannot write to this encounter: 403 plus a PERMISSION_DENIED audit entry', async () => {
       const res = await post(`/clinical/encounters/${encounter.id}/notes`, clinician2, noteBody());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await auditForRequest('PERMISSION_DENIED', res.body.error.requestId)).toBe(1);
    });

    it('front_desk and admin cannot write clinical notes (403)', async () => {
      const a = await post(`/clinical/encounters/${encounter.id}/notes`, frontDesk, noteBody());
      const b = await post(`/clinical/encounters/${encounter.id}/notes`, admin, noteBody());
      expect(a.status).toBe(403);
      expect(b.status).toBe(403);
    });

    it('unknown encounter is 404 and a malformed id is 422 (never a 500)', async () => {
      const missing = await post('/clinical/encounters/00000000-0000-4000-8000-000000000000/notes', clinician1, noteBody());
      expect(missing.status).toBe(404);
      const malformed = await post('/clinical/encounters/not-a-uuid/notes', clinician1, noteBody());
      expect(malformed.status).toBe(422);
    });

    it('saves a prescription with items; audit holds counts only, never medicine names', async () => {
      const res = await post(`/clinical/encounters/${encounter.id}/prescriptions`, clinician1, {
        instructions: 'Review in 2 weeks',
        items: [
          { medicineName: MED_MARKER, dosage: '5mg', frequency: '1-0-0', durationDays: 14 },
          { medicineName: 'Paracetamol', dosage: '500mg', frequency: '1-1-1', durationDays: 3 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.items).toHaveLength(2);
      expect(await auditCount('CREATE_PRESCRIPTION', res.body.data.id)).toBe(1);

      const audit = await query(
        "SELECT after_state FROM audit_log WHERE action = 'CREATE_PRESCRIPTION' AND entity_id = $1",
        [res.body.data.id]
      );
      expect(audit.rows[0].after_state.itemCount).toBe(2);
      expect(JSON.stringify(audit.rows[0].after_state)).not.toContain(MED_MARKER);
    });

    it('rejects an empty prescription and a non-positive duration with 422', async () => {
      const empty = await post(`/clinical/encounters/${encounter.id}/prescriptions`, clinician1, { items: [] });
      expect(empty.status).toBe(422);
      const badDuration = await post(`/clinical/encounters/${encounter.id}/prescriptions`, clinician1, {
        items: [{ medicineName: 'X', dosage: '1', frequency: 'daily', durationDays: 0 }],
      });
      expect(badDuration.status).toBe(422);
    });

    it('diagnostic report metadata: allowed for a treating clinician, 403+audit otherwise, 422 on bad category', async () => {
      const ok = await post('/clinical/diagnostic-reports', clinician1, {
        patientId: patient.id,
        encounterId: encounter.id,
        testName: 'ECG',
        category: 'cardiology',
        fileName: 'ecg.pdf',
      });
      expect(ok.status).toBe(201);
      expect(await auditCount('CREATE_DIAGNOSTIC_REPORT', ok.body.data.id)).toBe(1);

      const denied = await post('/clinical/diagnostic-reports', clinician2, {
        patientId: patient.id,
        testName: 'ECG',
        category: 'cardiology',
        fileName: 'ecg.pdf',
      });
      expect(denied.status).toBe(403);
      expect(await auditForRequest('PERMISSION_DENIED', denied.body.error.requestId)).toBe(1);

      const bad = await post('/clinical/diagnostic-reports', clinician1, {
        patientId: patient.id,
        testName: 'ECG',
        category: 'astrology',
        fileName: 'ecg.pdf',
      });
      expect(bad.status).toBe(422);
    });

    it('treating clinician reads the full record (audited); admin, front_desk and an unrelated clinician get 403', async () => {
      const res = await get(`/clinical/patients/${patient.id}/records`, clinician1);
      expect(res.status).toBe(200);
      expect(res.body.data.notes.some((n) => n.diagnosis_notes === NOTE_MARKER)).toBe(true);
      expect(res.body.data.prescriptions[0].items.length).toBeGreaterThan(0);
      expect(res.body.data.reports.length).toBeGreaterThan(0);
      expect(await auditCount('READ_CLINICAL_RECORD', patient.id)).toBeGreaterThanOrEqual(1);

      expect((await get(`/clinical/patients/${patient.id}/records`, admin)).status).toBe(403);
      expect((await get(`/clinical/patients/${patient.id}/records`, frontDesk)).status).toBe(403);
      expect((await get(`/clinical/patients/${patient.id}/records`, clinician2)).status).toBe(403);
    });

    it('closed encounters reject further notes with 409 ENCOUNTER_CLOSED', async () => {
      expect((await setStatus(clinician1, appointment.id, 'completed')).status).toBe(200);
      const res = await post(`/clinical/encounters/${encounter.id}/notes`, clinician1, noteBody());
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ENCOUNTER_CLOSED');
    });

    it('encounter list: admin gets metadata only (no clinical content), clinician only their own, front_desk 403', async () => {
      const adminRes = await get('/clinical/encounters?pageSize=100', admin);
      expect(adminRes.status).toBe(200);
      expect(adminRes.body.total).toBeGreaterThan(0);
      const raw = JSON.stringify(adminRes.body);
      expect(raw).not.toContain(NOTE_MARKER);
      expect(raw).not.toContain('chief_complaint');
      expect(raw).not.toContain('diagnosis_notes');

      const c1 = await get('/clinical/encounters?pageSize=100', clinician1);
      expect(c1.status).toBe(200);
      expect(c1.body.data.every((e) => e.doctor_id === doctor1.id)).toBe(true);
      const c2 = await get('/clinical/encounters?pageSize=100', clinician2);
      expect(c2.body.data.every((e) => e.doctor_id === doctor2.id)).toBe(true);

      expect((await get('/clinical/encounters', frontDesk)).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Billing: invoices', () => {
    it('computes totals in integer paise on the server and reconciles', async () => {
      const patient = await newPatient();
      const data = await newInvoice({
        patient,
        items: [
          { description: 'Consultation', quantity: 2, unitPricePaise: 50000 },
          { description: 'ECG', quantity: 1, unitPricePaise: 25000 },
        ],
        taxPaise: 6250,
        discountPaise: 1000,
      });
      expect(data.invoice.subtotal_paise).toBe(125000);
      expect(data.invoice.total_paise).toBe(130250);
      expect(Number.isInteger(data.invoice.total_paise)).toBe(true);
      expect(data.invoice.status).toBe('unpaid');
      expect(data.items).toHaveLength(2);
      expect(data.reconciliation.consistent).toBe(true);
      expect(data.reconciliation.balancePaise).toBe(130250);
    });

    it('rejects fractional, negative, empty and impossible amounts with 422', async () => {
      const patient = await newPatient();
      const attempt = (body) => post('/billing/invoices', frontDesk, { patientId: patient.id, ...body }, tag(`bad-${Math.random()}`));
      const ok = [{ description: 'X', quantity: 1, unitPricePaise: 1000 }];

      expect((await attempt({ items: [{ description: 'X', quantity: 1, unitPricePaise: 10.5 }] })).status).toBe(422);
      expect((await attempt({ items: [{ description: 'X', quantity: 1, unitPricePaise: -5 }] })).status).toBe(422);
      expect((await attempt({ items: [{ description: 'X', quantity: 0, unitPricePaise: 5 }] })).status).toBe(422);
      expect((await attempt({ items: [] })).status).toBe(422);
      expect((await attempt({ items: ok, taxPaise: -1 })).status).toBe(422);
      const tooMuchDiscount = await attempt({ items: ok, taxPaise: 0, discountPaise: 5000 });
      expect(tooMuchDiscount.status).toBe(422);
      expect(tooMuchDiscount.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('requires an Idempotency-Key and replays the same invoice for a repeated key', async () => {
      const patient = await newPatient();
      const body = { patientId: patient.id, items: [{ description: 'X', quantity: 1, unitPricePaise: 1000 }] };

      const noKey = await post('/billing/invoices', frontDesk, body);
      expect(noKey.status).toBe(422);

      const key = tag('replay-invoice');
      const first = await post('/billing/invoices', frontDesk, body, key);
      const second = await post('/billing/invoices', frontDesk, body, key);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.invoice.id).toBe(first.body.data.invoice.id);
      const n = await query('SELECT COUNT(*)::int AS n FROM invoices WHERE patient_id = $1', [patient.id]);
      expect(n.rows[0].n).toBe(1);
    });

    it('one active invoice per appointment (409 INVOICE_EXISTS); appointment must belong to the patient', async () => {
      const patient = await newPatient();
      const other = await newPatient();
      const appt = await newAppointment({ patient, status: 'completed' });
      await newInvoice({ patient, appointmentId: appt.id });

      const dup = await post(
        '/billing/invoices',
        frontDesk,
        { patientId: patient.id, appointmentId: appt.id, items: [{ description: 'X', quantity: 1, unitPricePaise: 1 }] },
        tag('dup')
      );
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('INVOICE_EXISTS');

      const wrongPatient = await post(
        '/billing/invoices',
        frontDesk,
        { patientId: other.id, appointmentId: appt.id, items: [{ description: 'X', quantity: 1, unitPricePaise: 1 }] },
        tag('wrong')
      );
      expect(wrongPatient.status).toBe(422);
    });

    it('lists with status filter, search and pagination; money comes back as numbers', async () => {
      const patient = await newPatient('Searchable Billing Patient');
      const data = await newInvoice({ patient });

      const byNumber = await get(`/billing/invoices?q=${encodeURIComponent(data.invoice.invoice_number)}`, frontDesk);
      expect(byNumber.status).toBe(200);
      expect(byNumber.body.total).toBe(1);
      expect(typeof byNumber.body.data[0].total_paise).toBe('number');

      const paged = await get('/billing/invoices?page=1&pageSize=2', admin);
      expect(paged.body.data.length).toBeLessThanOrEqual(2);
      expect(paged.body.total).toBeGreaterThan(2);
      expect(paged.body.pageSize).toBe(2);

      const paid = await get('/billing/invoices?status=paid&pageSize=100', admin);
      expect(paid.body.data.every((i) => i.status === 'paid')).toBe(true);
    });

    it('seeded invoices all reconcile (items + tax - discount = total, status matches payments)', async () => {
      const list = await get('/billing/invoices?status=paid&pageSize=10', admin);
      expect(list.body.data.length).toBeGreaterThan(0);
      for (const inv of list.body.data) {
        const detail = await get(`/billing/invoices/${inv.id}`, admin);
        expect(detail.body.data.reconciliation.consistent).toBe(true);
      }
    });

    it('a malformed invoice id is 422, an unknown one is 404', async () => {
      expect((await get('/billing/invoices/not-a-uuid', admin)).status).toBe(422);
      expect((await get('/billing/invoices/00000000-0000-4000-8000-000000000000', admin)).status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Billing: payments', () => {
    it('partial then final payment moves unpaid -> partial -> paid; overpaying a settled invoice is blocked', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient }); // 100000 paise

      const p1 = await pay(invoice.id, { amountPaise: 40000, method: 'cash' });
      expect(p1.status).toBe(201);
      expect(p1.body.data.invoiceStatus).toBe('partial');

      const p2 = await pay(invoice.id, { amountPaise: 60000, method: 'upi' });
      expect(p2.status).toBe(201);
      expect(p2.body.data.invoiceStatus).toBe('paid');

      const p3 = await pay(invoice.id, { amountPaise: 1, method: 'cash' });
      expect(p3.status).toBe(409);
      expect(p3.body.error.code).toBe('INVOICE_ALREADY_PAID');

      const detail = await get(`/billing/invoices/${invoice.id}`, frontDesk);
      expect(detail.body.data.reconciliation.paidPaise).toBe(100000);
      expect(detail.body.data.reconciliation.balancePaise).toBe(0);
      expect(detail.body.data.reconciliation.consistent).toBe(true);
    });

    it('rejects overpayment (422 OVERPAYMENT_REJECTED): no payment row, invoice unchanged, attempt audited', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient });
      const before = await auditCount('PAYMENT_REJECTED_OVERPAYMENT', invoice.id);

      const res = await pay(invoice.id, { amountPaise: 100001, method: 'cash' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('OVERPAYMENT_REJECTED');
      expect(res.body.error.details.balancePaise).toBe(100000);

      const rows = await query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1', [invoice.id]);
      expect(rows.rows[0].n).toBe(0);
      const inv = await query('SELECT status FROM invoices WHERE id = $1', [invoice.id]);
      expect(inv.rows[0].status).toBe('unpaid');
      expect(await auditCount('PAYMENT_REJECTED_OVERPAYMENT', invoice.id)).toBe(before + 1);
    });

    it('a declined card is recorded but moves no money; only the last four digits are ever stored', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient });
      const FULL_CARD = '4000000000000002';

      const res = await pay(invoice.id, { amountPaise: 50000, method: 'card', cardNumber: FULL_CARD });
      expect(res.status).toBe(402);
      expect(res.body.error.code).toBe('PAYMENT_DECLINED');

      const rows = await query('SELECT * FROM payments WHERE invoice_id = $1', [invoice.id]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].status).toBe('declined');
      expect(rows.rows[0].card_last_four).toBe('0002');

      const inv = await query('SELECT status FROM invoices WHERE id = $1', [invoice.id]);
      expect(inv.rows[0].status).toBe('unpaid');

      // The full card number must not exist anywhere we persist or return
      const audit = await query('SELECT after_state, before_state FROM audit_log WHERE entity_id = $1', [invoice.id]);
      expect(JSON.stringify(rows.rows)).not.toContain(FULL_CARD);
      expect(JSON.stringify(audit.rows)).not.toContain(FULL_CARD);
      expect(JSON.stringify(res.body)).not.toContain(FULL_CARD);

      // A retry with the success test card then settles it
      const ok = await pay(invoice.id, { amountPaise: 100000, method: 'card', cardNumber: '4242 4242 4242 4242' });
      expect(ok.status).toBe(201);
      expect(ok.body.data.invoiceStatus).toBe('paid');
    });

    it('rejects unknown card numbers and a card payment without a number (422)', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient });
      expect((await pay(invoice.id, { amountPaise: 1000, method: 'card', cardNumber: '5555555555554444' })).status).toBe(422);
      expect((await pay(invoice.id, { amountPaise: 1000, method: 'card' })).status).toBe(422);
      expect((await pay(invoice.id, { amountPaise: 10.5, method: 'cash' })).status).toBe(422);
      expect((await pay(invoice.id, { amountPaise: 0, method: 'cash' })).status).toBe(422);
    });

    it('RACE: 10 concurrent payments of 40% each can never exceed the invoice (exactly 2 succeed)', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient }); // 100000

      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => pay(invoice.id, { amountPaise: 40000, method: 'cash' }, tag(`race-${i}`)))
      );
      const ok = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status !== 201);

      expect(ok).toHaveLength(2);
      expect(rejected).toHaveLength(8);
      // Once the invoice cannot take another 40000 the error is OVERPAYMENT_REJECTED (balance 20000)
      expect(rejected.every((r) => r.status === 422 && r.body.error.code === 'OVERPAYMENT_REJECTED')).toBe(true);

      const sum = await query(
        "SELECT COALESCE(SUM(amount_paise), 0)::int AS paid FROM payments WHERE invoice_id = $1 AND status = 'success'",
        [invoice.id]
      );
      expect(sum.rows[0].paid).toBe(80000);
      const inv = await query('SELECT status FROM invoices WHERE id = $1', [invoice.id]);
      expect(inv.rows[0].status).toBe('partial');
    });

    it('RACE: 10 concurrent payments with the SAME Idempotency-Key charge exactly once', async () => {
      const patient = await newPatient();
      const { invoice } = await newInvoice({ patient });
      const key = tag('same-pay-key');

      const results = await Promise.all(
        Array.from({ length: 10 }, () => pay(invoice.id, { amountPaise: 30000, method: 'cash' }, key))
      );
      for (const r of results) {
        const allowed = r.status === 201 || (r.status === 409 && r.body.error.code === 'IDEMPOTENCY_IN_PROGRESS');
        expect(allowed).toBe(true);
      }
      expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);

      const rows = await query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id = $1', [invoice.id]);
      expect(rows.rows[0].n).toBe(1);
    });

    it('invoice cancellation: needs a reason, blocked once money was taken, frees the appointment for re-invoicing', async () => {
      const patient = await newPatient();
      const appt = await newAppointment({ patient, status: 'completed' });
      const { invoice } = await newInvoice({ patient, appointmentId: appt.id });

      const noReason = await request(app).patch(`/api/v1/billing/invoices/${invoice.id}/cancel`).set('Cookie', frontDesk.cookie).send({});
      expect(noReason.status).toBe(422);

      const cancel = await request(app)
        .patch(`/api/v1/billing/invoices/${invoice.id}/cancel`)
        .set('Cookie', frontDesk.cookie)
        .send({ reason: 'Entered by mistake' });
      expect(cancel.status).toBe(200);
      expect(cancel.body.data.invoice.status).toBe('cancelled');
      expect(await auditCount('CANCEL_INVOICE', invoice.id)).toBe(1);

      const payCancelled = await pay(invoice.id, { amountPaise: 100, method: 'cash' });
      expect(payCancelled.status).toBe(409);
      expect(payCancelled.body.error.code).toBe('INVOICE_CANCELLED');

      // The cancelled invoice no longer blocks a fresh invoice for the same appointment
      const fresh = await newInvoice({ patient, appointmentId: appt.id });
      expect(fresh.invoice.id).not.toBe(invoice.id);

      // An invoice with a successful payment cannot be cancelled
      await pay(fresh.invoice.id, { amountPaise: 500, method: 'cash' });
      const blocked = await request(app)
        .patch(`/api/v1/billing/invoices/${fresh.invoice.id}/cancel`)
        .set('Cookie', frontDesk.cookie)
        .send({ reason: 'Too late to cancel' });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('INVOICE_HAS_PAYMENTS');
    });
  });

  // ---------------------------------------------------------------------------
  describe('Billing: authorization (role x endpoint)', () => {
    let invoice;
    beforeAll(async () => {
      const patient = await newPatient();
      invoice = (await newInvoice({ patient })).invoice;
    });

    it('clinician is denied every billing endpoint (403) and the denial is audited', async () => {
      const before = await auditCount('PERMISSION_DENIED');
      expect((await get('/billing/invoices', clinician1)).status).toBe(403);
      expect((await get(`/billing/invoices/${invoice.id}`, clinician1)).status).toBe(403);
      expect((await post('/billing/invoices', clinician1, {}, tag('c1'))).status).toBe(403);
      expect((await post(`/billing/invoices/${invoice.id}/payments`, clinician1, { amountPaise: 1, method: 'cash' }, tag('c2'))).status).toBe(403);
      expect(await auditCount('PERMISSION_DENIED')).toBeGreaterThanOrEqual(before + 4);
    });

    it('admin is read-only: may list and read, but create/pay/cancel are 403', async () => {
      expect((await get('/billing/invoices', admin)).status).toBe(200);
      expect((await get(`/billing/invoices/${invoice.id}`, admin)).status).toBe(200);
      expect((await post('/billing/invoices', admin, {}, tag('a1'))).status).toBe(403);
      expect((await post(`/billing/invoices/${invoice.id}/payments`, admin, { amountPaise: 1, method: 'cash' }, tag('a2'))).status).toBe(403);
      const cancel = await request(app)
        .patch(`/api/v1/billing/invoices/${invoice.id}/cancel`)
        .set('Cookie', admin.cookie)
        .send({ reason: 'admin tries to cancel' });
      expect(cancel.status).toBe(403);
    });

    it('unauthenticated requests are 401', async () => {
      expect((await request(app).get('/api/v1/billing/invoices')).status).toBe(401);
      expect((await request(app).get('/api/v1/reports/summary')).status).toBe(401);
      expect((await request(app).get('/api/v1/clinical/encounters')).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Admin reports', () => {
    it('summary numbers equal an independent SQL calculation', async () => {
      // 300-day window ending today (hospital-local), well inside the 366-day limit
      const fmt = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const to = fmt(new Date());
      const from = fmt(new Date(Date.now() - 300 * 86400000));

      const res = await get(`/reports/summary?from=${from}&to=${to}`, admin);
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(d.range).toEqual({ from, to, timezone: 'Asia/Kolkata' });

      // Independent check: SQL does the hospital-local date bounds itself (not the JS conversion under test)
      const inRange = "(created_at AT TIME ZONE 'Asia/Kolkata') >= $1::date AND (created_at AT TIME ZONE 'Asia/Kolkata') < ($2::date + 1)";
      const revenue = await query(
        `SELECT COALESCE(SUM(amount_paise), 0)::bigint AS v FROM payments WHERE status = 'success' AND ${inRange}`,
        [from, to]
      );
      expect(d.revenuePaise).toBe(Number(revenue.rows[0].v));
      expect(d.revenuePaise).toBeGreaterThan(0);
      expect(d.revenueByMethod.reduce((s, r) => s + r.total_paise, 0)).toBe(d.revenuePaise);
      expect(d.dailyRevenue.reduce((s, r) => s + r.total_paise, 0)).toBe(d.revenuePaise);

      const declined = await query(
        `SELECT COUNT(*)::int AS n FROM payments WHERE status IN ('declined', 'failed') AND ${inRange}`,
        [from, to]
      );
      expect(d.declinedPayments).toBe(declined.rows[0].n);

      const outstanding = await query(
        `SELECT COALESCE(SUM(i.total_paise - COALESCE(p.paid, 0)), 0)::bigint AS v
         FROM invoices i
         LEFT JOIN (SELECT invoice_id, SUM(amount_paise) AS paid FROM payments WHERE status = 'success' GROUP BY invoice_id) p
           ON p.invoice_id = i.id
         WHERE i.status <> 'cancelled'`
      );
      expect(d.outstandingPaise).toBe(Number(outstanding.rows[0].v));

      const appts = await query(
        "SELECT COUNT(*)::int AS n FROM appointments WHERE (starts_at AT TIME ZONE 'Asia/Kolkata') >= $1::date AND (starts_at AT TIME ZONE 'Asia/Kolkata') < ($2::date + 1)",
        [from, to]
      );
      expect(d.totalAppointments).toBe(appts.rows[0].n);
    });

    it('only admin may read it; bad ranges are 422', async () => {
      expect((await get('/reports/summary', frontDesk)).status).toBe(403);
      expect((await get('/reports/summary', clinician1)).status).toBe(403);
      expect((await get('/reports/summary?from=2026-02-31x', admin)).status).toBe(422);
      expect((await get('/reports/summary?from=2026-05-02&to=2026-05-01', admin)).status).toBe(422);
      expect((await get('/reports/summary?from=2020-01-01&to=2026-01-01', admin)).status).toBe(422);
      expect((await get('/reports/summary', admin)).status).toBe(200); // default 30-day window
    });
  });

  // ---------------------------------------------------------------------------
  describe('Audit log viewer', () => {
    it('is paginated with a total, filterable by action, actor and date, admin only', async () => {
      const page = await get('/audit/logs?page=1&pageSize=5', admin);
      expect(page.status).toBe(200);
      expect(page.body.data).toHaveLength(5);
      expect(page.body.total).toBeGreaterThan(5);
      expect(page.body.pageSize).toBe(5);
      expect(page.body.data[0]).toHaveProperty('actor_name');

      const page2 = await get('/audit/logs?page=2&pageSize=5', admin);
      expect(page2.body.data[0].id).not.toBe(page.body.data[0].id);

      const byAction = await get('/audit/logs?action=CREATE_PAYMENT&pageSize=100', admin);
      expect(byAction.body.data.length).toBeGreaterThan(0);
      expect(byAction.body.data.every((l) => l.action === 'CREATE_PAYMENT')).toBe(true);

      const byActor = await get(`/audit/logs?actorId=${frontDeskUser.id}&pageSize=100`, admin);
      expect(byActor.body.data.every((l) => l.actor_id === frontDeskUser.id)).toBe(true);

      const today = new Date().toISOString().slice(0, 10);
      const dated = await get(`/audit/logs?from=${today}&to=${today}&pageSize=100`, admin);
      expect(dated.body.total).toBeGreaterThan(0);
      const future = await get('/audit/logs?from=2099-01-01&to=2099-01-02', admin);
      expect(future.body.total).toBe(0);

      expect((await get('/audit/logs?from=yesterday', admin)).status).toBe(422);
      expect((await get('/audit/logs', frontDesk)).status).toBe(403);
    });

    it('stays append-only: UPDATE and DELETE on audit_log are rejected by the database', async () => {
      await expect(query("UPDATE audit_log SET action = 'TAMPERED' WHERE true")).rejects.toThrow(/append-only/);
      await expect(query('DELETE FROM audit_log WHERE true')).rejects.toThrow(/append-only/);
    });
  });
  // ---------------------------------------------------------------------------
  describe('Patients: update validation and atomicity', () => {
    const put = (id, auth, body) =>
      request(app).put(`/api/v1/patients/${id}`).set('Cookie', auth.cookie).send(body);

    it('applies a valid update and stores before/after in one audit entry; empty email clears it', async () => {
      const patient = await newPatient('Update Me');
      const res = await put(patient.id, frontDesk, { phone: '+91 9111111111', bloodGroup: 'O+', email: '' });
      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe('+91 9111111111');
      expect(res.body.data.blood_group).toBe('O+');
      expect(res.body.data.email).toBeNull();

      const audit = await query(
        "SELECT before_state, after_state FROM audit_log WHERE action = 'UPDATE_PATIENT' AND entity_id = $1",
        [patient.id]
      );
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0].before_state.phone).toBe('+91 9000000000');
      expect(audit.rows[0].after_state.phone).toBe('+91 9111111111');
    });

    it('rejects malformed values with 422 and changes nothing', async () => {
      const patient = await newPatient('Strict Validation');
      const bad = [
        { email: 'not-an-email' },
        { bloodGroup: 'Z9' },
        { fullName: { evil: 'object' } },
        { phone: 123456789 },
        { fullName: 'A' },
        { allergies: 'x'.repeat(1001) },
      ];
      for (const body of bad) {
        const res = await put(patient.id, frontDesk, body);
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      const row = await query('SELECT full_name, phone, email, blood_group FROM patients WHERE id = $1', [patient.id]);
      expect(row.rows[0].phone).toBe('+91 9000000000');
      expect(row.rows[0].blood_group).toBeNull();
    });

    it('cannot overwrite fields outside the allowed set (mrn, is_active, id): unknown keys are 422', async () => {
      const patient = await newPatient('No Mass Assignment');
      for (const body of [{ mrn: 'HACKED' }, { isActive: false }, { is_active: false }, { id: '00000000-0000-4000-8000-000000000000' }]) {
        const res = await put(patient.id, frontDesk, { phone: '+91 9222222222', ...body });
        expect(res.status).toBe(422);
      }
      const row = await query('SELECT mrn, is_active, phone FROM patients WHERE id = $1', [patient.id]);
      expect(row.rows[0].mrn).not.toBe('HACKED');
      expect(row.rows[0].is_active).toBe(true);
      expect(row.rows[0].phone).toBe('+91 9000000000');
    });

    it('only front_desk may update (admin and clinician are 403); unknown patient is 404; bad id is 422', async () => {
      const patient = await newPatient();
      expect((await put(patient.id, admin, { phone: '+91 9333333333' })).status).toBe(403);
      expect((await put(patient.id, clinician1, { phone: '+91 9333333333' })).status).toBe(403);
      expect((await put('00000000-0000-4000-8000-000000000000', frontDesk, { phone: '+91 9333333333' })).status).toBe(404);
      expect((await put('nope', frontDesk, { phone: '+91 9333333333' })).status).toBe(422);
    });

    it('update and audit are atomic: if the audit write fails the patient row is unchanged', async () => {
      const patient = await newPatient('Atomic Update');
      const spy = vi.spyOn(auditService, 'logAction').mockRejectedValueOnce(new Error('simulated audit outage'));
      const res = await put(patient.id, frontDesk, { phone: '+91 9444444444' });
      spy.mockRestore();

      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toMatch(/simulated audit outage/);
      const row = await query('SELECT phone FROM patients WHERE id = $1', [patient.id]);
      expect(row.rows[0].phone).toBe('+91 9000000000');
    });

    it('concurrent updates serialise on the row lock: every audit entry has a consistent before/after chain', async () => {
      const patient = await newPatient('Concurrent Update');
      const phones = Array.from({ length: 8 }, (_, i) => `+91 95000000${String(i).padStart(2, '0')}`);
      const results = await Promise.all(phones.map((phone) => put(patient.id, frontDesk, { phone })));
      expect(results.every((r) => r.status === 200)).toBe(true);

      const audit = await query(
        "SELECT before_state->>'phone' AS before, after_state->>'phone' AS after FROM audit_log WHERE action = 'UPDATE_PATIENT' AND entity_id = $1 ORDER BY ts, id",
        [patient.id]
      );
      expect(audit.rows).toHaveLength(8);
      // Each update's "before" must equal the previous update's "after": no lost-update snapshots
      expect(audit.rows[0].before).toBe('+91 9000000000');
      for (let i = 1; i < audit.rows.length; i++) {
        expect(audit.rows[i].before).toBe(audit.rows[i - 1].after);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('Directory: access revocation, atomic account creation, staff safety', () => {
    const doctorPayload = (n) => ({
      email: `p3doc.${RUN}.${n}@aarogya.local`,
      password: 'Password123!',
      fullName: `P3 Doctor ${n}`,
      phone: '+91 9555555555',
      departmentId: doctor1.department_id,
      specialization: 'General Medicine',
      consultationFeePaise: 50000,
    });
    const createDoctor = (body) => post('/directory/doctors', admin, body);

    it('deleting a doctor revokes access: the existing session AND new logins stop working', async () => {
      const body = doctorPayload('revoke');
      const created = await createDoctor(body);
      expect(created.status).toBe(201);

      const session = await loginAs(body.email);
      expect((await get('/auth/me', session)).status).toBe(200);

      const del = await request(app)
        .delete(`/api/v1/directory/doctors/${created.body.data.id}`)
        .set('Cookie', admin.cookie);
      expect(del.status).toBe(200);

      // The cookie issued before removal must no longer work
      expect((await get('/auth/me', session)).status).toBe(401);
      expect((await get('/patients', session)).status).toBe(401);
      // ...and signing in again is refused
      const relogin = await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password });
      expect(relogin.status).toBe(401);

      const user = await query('SELECT is_active FROM users WHERE LOWER(email) = LOWER($1)', [body.email]);
      expect(user.rows[0].is_active).toBe(false);
    });

    it('PATCH isActive false/true toggles the doctor login in step', async () => {
      const body = doctorPayload('toggle');
      const created = await createDoctor(body);
      const id = created.body.data.id;
      const patch = (isActive) =>
        request(app).patch(`/api/v1/directory/doctors/${id}`).set('Cookie', admin.cookie).send({ isActive });

      expect((await patch(false)).status).toBe(200);
      expect(
        (await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password })).status
      ).toBe(401);

      expect((await patch(true)).status).toBe(200);
      expect(
        (await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password })).status
      ).toBe(200);
    });

    it('creating a doctor is atomic: a failing audit write leaves no orphan login account', async () => {
      const body = doctorPayload('atomic');
      const spy = vi.spyOn(auditService, 'logAction').mockRejectedValueOnce(new Error('simulated audit outage'));
      const res = await createDoctor(body);
      spy.mockRestore();

      expect(res.status).toBe(500);
      const users = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [body.email]);
      expect(users.rows).toHaveLength(0);
    });

    it('unknown department is 404 and creates no account; duplicate email is 409', async () => {
      const body = doctorPayload('nodept');
      const noDept = await createDoctor({ ...body, departmentId: '00000000-0000-4000-8000-000000000000' });
      expect(noDept.status).toBe(404);
      const users = await query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [body.email]);
      expect(users.rows).toHaveLength(0);

      const first = await createDoctor(doctorPayload('dup'));
      expect(first.status).toBe(201);
      const dup = await createDoctor({ ...doctorPayload('dup'), email: doctorPayload('dup').email.toUpperCase() });
      expect(dup.status).toBe(409);
    });

    it('doctor and staff creation is admin-only (front_desk and clinician get 403)', async () => {
      expect((await post('/directory/doctors', frontDesk, doctorPayload('rbac1'))).status).toBe(403);
      expect((await post('/directory/doctors', clinician1, doctorPayload('rbac2'))).status).toBe(403);
      const staff = { email: `p3staff.rbac.${RUN}@aarogya.local`, password: 'Password123!', fullName: 'X Y', phone: '+91 9666666666', role: 'front_desk' };
      expect((await post('/directory/staff', frontDesk, staff)).status).toBe(403);
    });

    it('staff list never exposes password hashes; an admin cannot deactivate their own account', async () => {
      const list = await get('/directory/staff?pageSize=100', admin);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toMatch(/password/i);
      expect(JSON.stringify(list.body)).not.toMatch(/\$2[aby]\$/); // bcrypt hash prefix

      const self = await request(app)
        .patch(`/api/v1/directory/staff/${adminUser.id}/status`)
        .set('Cookie', admin.cookie)
        .send({ isActive: false });
      expect(self.status).toBe(409);
      expect(self.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
      const still = await query('SELECT is_active FROM users WHERE id = $1', [adminUser.id]);
      expect(still.rows[0].is_active).toBe(true);
    });

    it('a deactivated staff account cannot sign in, and its audit entry records before/after', async () => {
      const body = { email: `p3staff.${RUN}@aarogya.local`, password: 'Password123!', fullName: 'Temp Staff', phone: '+91 9777777777', role: 'front_desk' };
      const created = await post('/directory/staff', admin, body);
      expect(created.status).toBe(201);
      expect(created.body.data).not.toHaveProperty('password_hash');

      const off = await request(app)
        .patch(`/api/v1/directory/staff/${created.body.data.id}/status`)
        .set('Cookie', admin.cookie)
        .send({ isActive: false });
      expect(off.status).toBe(200);
      expect(
        (await request(app).post('/api/v1/auth/login').send({ email: body.email, password: body.password })).status
      ).toBe(401);

      const audit = await query(
        "SELECT before_state, after_state FROM audit_log WHERE action = 'UPDATE_STAFF_STATUS' AND entity_id = $1",
        [created.body.data.id]
      );
      expect(audit.rows[0].before_state.is_active).toBe(true);
      expect(audit.rows[0].after_state.is_active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Pagination input is clamped on every list endpoint', () => {
    const lists = ['/appointments', '/patients', '/directory/staff', '/billing/invoices', '/audit/logs', '/clinical/encounters'];

    it.each(lists)('%s survives garbage, negative and oversized page/pageSize (200, pageSize <= 100)', async (path) => {
      for (const qs of ['page=abc&pageSize=xyz', 'page=-3&pageSize=-5', 'page=0&pageSize=0', 'pageSize=1000000']) {
        const res = await get(`${path}?${qs}`, admin);
        // admin may not be allowed on every list; what must never happen is a 500
        expect([200, 403]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body.pageSize).toBeLessThanOrEqual(100);
          expect(res.body.pageSize).toBeGreaterThanOrEqual(1);
          expect(res.body.page).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('slot search clamps too', async () => {
      const res = await get('/slots?doctorId=' + doctor1.id + '&pageSize=99999&page=abc', frontDesk);
      expect(res.status).not.toBe(500);
    });
  });

});

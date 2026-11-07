import http from 'http';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { hospitalLocalToUtc } from '../src/utils/timezone.js';

async function runRealHttpRaceDemo() {
  console.log('=== Aarogya HMS: Concurrent HTTP Race Demo (PostgreSQL btree_gist) ===\n');

  // 1. Start ephemeral HTTP server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[Server] Live test server listening on ${baseUrl}`);

  try {
    // 2. Log in as front-desk user
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'frontdesk1@aarogya.local',
        password: 'Password123!',
      }),
    });

    const loginData = await loginRes.json();
    if (loginRes.status !== 200) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }

    const cookieHeader = loginRes.headers.get('set-cookie');
    const authHeaders = {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    };
    console.log('[Auth] Authenticated as front-desk successfully.\n');

    // Fetch test doctor and patients
    const docRes = await query(
      "SELECT d.id, u.full_name FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.email = 'dr.sharma@aarogya.local' LIMIT 1;"
    );
    const doctor = docRes.rows[0];

    const patientsRes = await query('SELECT id, full_name, mrn FROM patients LIMIT 25;');
    const patients = patientsRes.rows;

    if (!doctor || patients.length < 25) {
      throw new Error('Database must have doctor and at least 25 synthetic patients. Run npm run seed.');
    }

    // Clean up any old race artifacts
    await query("DELETE FROM appointments WHERE starts_at >= '2027-01-11T00:00:00Z' AND starts_at < '2027-01-12T00:00:00Z'");
    await query("DELETE FROM idempotency_keys WHERE idempotency_key LIKE 'race-%' OR idempotency_key LIKE 'sc3-%'");

    // Target Slot: Day in future on a Monday (Day of week 1) at 10:00 AM IST
    const targetDateStr = '2027-01-11'; // Monday
    const targetSlotStart = hospitalLocalToUtc(targetDateStr, '10:00:00').toISOString();
    const targetSlotEnd = hospitalLocalToUtc(targetDateStr, '10:15:00').toISOString();

    // -------------------------------------------------------------
    // SCENARIO 1: 20 Simultaneous HTTP Bookings for the Same Doctor & Slot
    // -------------------------------------------------------------
    console.log('--- SCENARIO 1: 20 Simultaneous HTTP Bookings for the Same Doctor+Slot ---');
    console.log(`Doctor: ${doctor.full_name} (${doctor.id})`);
    console.log(`Slot:   ${targetSlotStart} -> ${targetSlotEnd} (10:00 - 10:15 IST)`);
    console.log('Firing 20 simultaneous HTTP POST requests with 20 distinct patients...\n');

    const bookingPromises = patients.slice(0, 20).map((patient, idx) => {
      const idempotencyKey = `race-sc1-key-${idx}-${Date.now()}`;
      return fetch(`${baseUrl}/api/v1/appointments`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          patientId: patient.id,
          doctorId: doctor.id,
          startsAt: targetSlotStart,
          endsAt: targetSlotEnd,
          reasonForVisit: `Race test booking for patient ${idx + 1}`,
        }),
      }).then(async (res) => ({
        status: res.status,
        body: await res.json(),
      }));
    });

    const scenario1Results = await Promise.all(bookingPromises);

    const statusCounts = {};
    let winner = null;
    for (const r of scenario1Results) {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
      if (r.status === 201) {
        winner = r.body.data;
      }
    }

    console.log('Scenario 1 Status Code Breakdown:');
    for (const [code, count] of Object.entries(statusCounts)) {
      console.log(`  HTTP ${code}: ${count}`);
    }

    if (statusCounts['201'] !== 1 || statusCounts['409'] !== 19) {
      console.error(
        `[ASSERTION FAILED] Scenario 1 Expected exactly 1x201 and 19x409. Got:`,
        statusCounts
      );
      process.exit(1);
    }

    // Explicitly assert error.code === 'SLOT_TAKEN' on every 409 conflict
    const slotTakenErrors = scenario1Results.filter(
      (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
    );
    if (slotTakenErrors.length !== 19) {
      console.error(
        `[ASSERTION FAILED] Expected 19 responses with error.code 'SLOT_TAKEN', got ${slotTakenErrors.length}:`,
        scenario1Results.filter((r) => r.status === 409).map((r) => r.body)
      );
      process.exit(1);
    }
    console.log(`[PASSED] Winner Appointment ID: ${winner.id} (${winner.appointment_number}); all 19 rejections verified with error.code='SLOT_TAKEN'\n`);

    // -------------------------------------------------------------
    // SCENARIO 2: 10 Concurrent Requests with the SAME Idempotency-Key
    // -------------------------------------------------------------
    console.log('--- SCENARIO 2: 10 Concurrent Requests with the SAME Idempotency-Key ---');
    const sharedKey = `race-sc2-shared-key-${Date.now()}`;
    const sc2SlotStart = hospitalLocalToUtc(targetDateStr, '11:00:00').toISOString();
    const sc2SlotEnd = hospitalLocalToUtc(targetDateStr, '11:15:00').toISOString();
    const sc2Patient = patients[21];

    console.log(`Key:  ${sharedKey}`);
    console.log('Firing 10 concurrent HTTP POST requests with exact same Idempotency-Key...');

    const sharedKeyPromises = Array.from({ length: 10 }).map(() =>
      fetch(`${baseUrl}/api/v1/appointments`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Idempotency-Key': sharedKey,
        },
        body: JSON.stringify({
          patientId: sc2Patient.id,
          doctorId: doctor.id,
          startsAt: sc2SlotStart,
          endsAt: sc2SlotEnd,
          reasonForVisit: 'Idempotency concurrency test',
        }),
      }).then(async (res) => ({
        status: res.status,
        body: await res.json(),
      }))
    );

    const scenario2Results = await Promise.all(sharedKeyPromises);

    // Verify only 1 appointment row exists in DB for this slot
    const dbCountRes = await query(
      'SELECT COUNT(*) as cnt FROM appointments WHERE doctor_id = $1 AND starts_at = $2;',
      [doctor.id, sc2SlotStart]
    );
    const dbCount = parseInt(dbCountRes.rows[0].cnt, 10);
    console.log(`Appointments in Database for slot: ${dbCount}`);

    // All successful responses must return the same appointment ID
    const successfulResponses = scenario2Results.filter((r) => r.status === 201 || r.status === 200);
    const uniqueAptIds = new Set(successfulResponses.map((r) => r.body.data?.id));

    if (dbCount !== 1 || uniqueAptIds.size !== 1) {
      console.error(
        `[ASSERTION FAILED] Scenario 2 Expected exactly 1 DB row and 1 unique appointment ID. Got dbCount=${dbCount}, uniqueIds=${uniqueAptIds.size}`
      );
      process.exit(1);
    }
    console.log('[PASSED] Exactly 1 appointment row created; duplicate requests handled idempotently.\n');

    // -------------------------------------------------------------
    // SCENARIO 3: 5 Concurrent Reschedules into the Same Target Slot
    // -------------------------------------------------------------
    console.log('--- SCENARIO 3: 5 Concurrent Reschedules into the Same Target Slot ---');
    const sc3TargetStart = hospitalLocalToUtc(targetDateStr, '14:00:00').toISOString();
    const sc3TargetEnd = hospitalLocalToUtc(targetDateStr, '14:15:00').toISOString();

    // Create 5 distinct appointments at distinct initial slots
    const initialAppointments = [];
    for (let i = 0; i < 5; i++) {
      const startMinTotal = 15 * 60 + i * 15;
      const endMinTotal = startMinTotal + 15;

      const startH = String(Math.floor(startMinTotal / 60)).padStart(2, '0');
      const startM = String(startMinTotal % 60).padStart(2, '0');
      const endH = String(Math.floor(endMinTotal / 60)).padStart(2, '0');
      const endM = String(endMinTotal % 60).padStart(2, '0');

      const initStart = hospitalLocalToUtc(targetDateStr, `${startH}:${startM}:00`).toISOString();
      const initEnd = hospitalLocalToUtc(targetDateStr, `${endH}:${endM}:00`).toISOString();
      const aptRes = await fetch(`${baseUrl}/api/v1/appointments`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Idempotency-Key': `sc3-init-${i}-${Date.now()}`,
        },
        body: JSON.stringify({
          patientId: patients[i].id,
          doctorId: doctor.id,
          startsAt: initStart,
          endsAt: initEnd,
          reasonForVisit: `Pre-reschedule initial booking ${i}`,
        }),
      });
      const aptData = await aptRes.json();
      initialAppointments.push(aptData.data);
    }

    console.log(`Created 5 appointments. Now attempting concurrent reschedule to: ${sc3TargetStart}`);

    const reschedulePromises = initialAppointments.map((apt) =>
      fetch(`${baseUrl}/api/v1/appointments/${apt.id}/reschedule`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          startsAt: sc3TargetStart,
          endsAt: sc3TargetEnd,
          expectedVersion: apt.version,
        }),
      }).then(async (res) => ({
        status: res.status,
        body: await res.json(),
      }))
    );

    const scenario3Results = await Promise.all(reschedulePromises);

    const sc3Counts = {};
    for (const r of scenario3Results) {
      sc3Counts[r.status] = (sc3Counts[r.status] || 0) + 1;
    }

    console.log('Scenario 3 Status Code Breakdown:');
    for (const [code, count] of Object.entries(sc3Counts)) {
      console.log(`  HTTP ${code}: ${count}`);
    }

    if (sc3Counts['200'] !== 1 || sc3Counts['409'] !== 4) {
      console.error(
        `[ASSERTION FAILED] Scenario 3 Expected exactly 1x200 and 4x409. Got:`,
        sc3Counts
      );
      process.exit(1);
    }

    // Explicitly assert error.code === 'SLOT_TAKEN' on every 409 reschedule conflict
    const sc3SlotTakenErrors = scenario3Results.filter(
      (r) => r.status === 409 && r.body.error?.code === 'SLOT_TAKEN'
    );
    if (sc3SlotTakenErrors.length !== 4) {
      console.error(
        `[ASSERTION FAILED] Scenario 3 expected 4 responses with error.code 'SLOT_TAKEN', got ${sc3SlotTakenErrors.length}:`,
        scenario3Results.filter((r) => r.status === 409).map((r) => r.body)
      );
      process.exit(1);
    }
    console.log('[PASSED] Exactly 1 reschedule succeeded into target slot; 4 rejected with error.code=\'SLOT_TAKEN\'.\n');

    // Cleanup demo test records
    await query("DELETE FROM appointments WHERE starts_at >= '2027-01-11T00:00:00Z' AND starts_at < '2027-01-12T00:00:00Z';");
    await query("DELETE FROM idempotency_keys WHERE idempotency_key LIKE 'race-%' OR idempotency_key LIKE 'sc3-%';");
    console.log('[Cleanup] Demo test data cleaned up successfully.');

    console.log('\n=== ALL CONCURRENCY & RACE SCENARIOS PASSED WITH RIGOROUS ASSERTIONS ===');
    process.exit(0);
  } finally {
    server.close();
  }
}

runRealHttpRaceDemo().catch((err) => {
  console.error('[FATAL Race Demo Error]:', err);
  process.exit(1);
});

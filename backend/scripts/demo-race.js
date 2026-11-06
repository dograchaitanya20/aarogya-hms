import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms';

async function runRaceDemo() {
  console.log('=== Aarogya HMS: Double-Booking Prevention Demo (PostgreSQL btree_gist) ===\n');

  const pool = new pg.Pool({ connectionString });

  try {
    const docRes = await pool.query('SELECT d.id, d.department_id, u.full_name FROM doctors d JOIN users u ON u.id = d.user_id LIMIT 1;');
    const patientRes = await pool.query('SELECT id, full_name, mrn FROM patients LIMIT 2;');
    const userRes = await pool.query("SELECT id FROM users WHERE role = 'front_desk' LIMIT 1;");

    if (docRes.rows.length === 0 || patientRes.rows.length < 2) {
      console.error('Database must be seeded first! Run: npm run seed');
      process.exit(1);
    }

    const doctor = docRes.rows[0];
    const patient1 = patientRes.rows[0];
    const patient2 = patientRes.rows[1];
    const createdBy = userRes.rows[0].id;

    // Pick a test slot 45 days in future
    const testSlotStart = new Date(Date.now() + 45 * 24 * 3600 * 1000);
    testSlotStart.setMinutes(0, 0, 0);
    const testSlotEnd = new Date(testSlotStart.getTime() + 15 * 60 * 1000);

    console.log(`Doctor:    ${doctor.full_name} (ID: ${doctor.id})`);
    console.log(`Slot Time: ${testSlotStart.toISOString()} -> ${testSlotEnd.toISOString()}`);
    console.log(`Patient 1: ${patient1.full_name} (${patient1.mrn})`);
    console.log(`Patient 2: ${patient2.full_name} (${patient2.mrn})\n`);

    // Clean up
    await pool.query("DELETE FROM appointments WHERE appointment_number LIKE 'APT-RACE-%'");

    console.log('--- Step 1: Booking Appointment 1 for Patient 1 ---');
    const res1 = await pool.query(
      `
      INSERT INTO appointments (
        appointment_number, patient_id, doctor_id, department_id,
        starts_at, ends_at, status, reason_for_visit, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Initial consultation', $7)
      RETURNING id, appointment_number;
      `,
      ['APT-RACE-001', patient1.id, doctor.id, doctor.department_id, testSlotStart.toISOString(), testSlotEnd.toISOString(), createdBy]
    );
    console.log(`[SUCCESS] Appointment 1 booked: ${res1.rows[0].appointment_number} (ID: ${res1.rows[0].id})\n`);

    console.log('--- Step 2: Attempting to Book Overlapping Slot for Patient 2 ---');
    try {
      await pool.query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'scheduled', 'Concurrent conflicting consultation', $7)
        RETURNING id, appointment_number;
        `,
        ['APT-RACE-002', patient2.id, doctor.id, doctor.department_id, testSlotStart.toISOString(), testSlotEnd.toISOString(), createdBy]
      );
      console.error('[FAILURE] Error: Database allowed double-booking!');
    } catch (err) {
      console.log(`[BLOCKED] Database rejected double-booking as expected!`);
      console.log(`  SQLSTATE:   ${err.code}`);
      console.log(`  Constraint: ${err.constraint}`);
      console.log(`  Detail:     ${err.detail}`);
      console.log(`  Message:    ${err.message}`);

      if (err.code === '23P01') {
        console.log('\n[DEMO PASSED] Exclusion constraint "uq_doctor_slot_no_overlap" successfully enforced!');
      } else {
        console.log(`\nUnexpected error code: ${err.code}`);
      }
    }

    // Clean up
    await pool.query("DELETE FROM appointments WHERE appointment_number LIKE 'APT-RACE-%'");
  } finally {
    await pool.end();
  }
}

runRaceDemo().catch((err) => {
  console.error('Race demo error:', err);
  process.exit(1);
});

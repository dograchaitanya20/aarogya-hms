import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export async function runSeed(customDbUrl = null) {
  const connectionString =
    customDbUrl ||
    (process.env.NODE_ENV === 'test'
      ? process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms_test'
      : process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/aarogya_hms');

  const client = new pg.Client({ connectionString });
  await client.connect();

  console.log('[Seed] Starting idempotent synthetic data seed...');
  const defaultPassword = 'Password123!';
  const defaultPasswordHash = await bcrypt.hash(defaultPassword, 10);

  try {
    await client.query('BEGIN');

    // 1. Seed Admin User
    const adminRes = await client.query(
      `
      INSERT INTO users (email, password_hash, role, full_name, phone)
      VALUES ($1, $2, 'admin', 'System Administrator', '+91 9876543210')
      ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
      RETURNING id;
      `,
      ['admin@aarogya.local', defaultPasswordHash]
    );
    const adminId = adminRes.rows[0].id;

    // 2. Seed Front-Desk Users
    const frontDeskUsers = [
      { email: 'frontdesk1@aarogya.local', name: 'Aarav Receptionist', phone: '+91 9811122231' },
      { email: 'frontdesk2@aarogya.local', name: 'Diya Desk Coordinator', phone: '+91 9811122232' },
      { email: 'frontdesk3@aarogya.local', name: 'Kabir Patient Services', phone: '+91 9811122233' },
    ];

    const frontDeskIds = [];
    for (const fd of frontDeskUsers) {
      const fdRes = await client.query(
        `
        INSERT INTO users (email, password_hash, role, full_name, phone)
        VALUES ($1, $2, 'front_desk', $3, $4)
        ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id;
        `,
        [fd.email, defaultPasswordHash, fd.name, fd.phone]
      );
      frontDeskIds.push(fdRes.rows[0].id);
    }

    // 3. Seed 8 Departments
    const departmentsData = [
      { name: 'Cardiology', code: 'CARD', desc: 'Comprehensive cardiac care, diagnostics, and vascular therapy.' },
      { name: 'Orthopedics', code: 'ORTH', desc: 'Musculoskeletal surgery, trauma, joint replacements, and rehabilitation.' },
      { name: 'Pediatrics', code: 'PED', desc: 'General pediatrics, neonatal monitoring, and adolescent medicine.' },
      { name: 'Neurology', code: 'NEUR', desc: 'Neurological evaluation, stroke management, and epilepsy care.' },
      { name: 'Dermatology', code: 'DERM', desc: 'Clinical dermatology, allergies, and skin lesion management.' },
      { name: 'General Medicine', code: 'GMED', desc: 'Primary healthcare, internal medicine, and chronic disease management.' },
      { name: 'Gynecology', code: 'GYN', desc: 'Obstetrics, antenatal wellness, and gynecological surgeries.' },
      { name: 'Ophthalmology', code: 'OPHT', desc: 'Ophthalmic exams, cataract care, and retinal diagnostics.' },
    ];

    const departmentMap = new Map();
    for (const dept of departmentsData) {
      const deptRes = await client.query(
        `
        INSERT INTO departments (name, code, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
        RETURNING id, code;
        `,
        [dept.name, dept.code, dept.desc]
      );
      departmentMap.set(deptRes.rows[0].code, deptRes.rows[0].id);
    }

    // 4. Seed 16 Clinicians (2 per department) & Doctors with Schedules
    const doctorsData = [
      { email: 'dr.sharma@aarogya.local', name: 'Dr. Rajesh Sharma', dept: 'CARD', spec: 'Interventional Cardiology', fee: 120000, room: 'Room 101' },
      { email: 'dr.menon@aarogya.local', name: 'Dr. Priya Menon', dept: 'CARD', spec: 'Electrophysiology', fee: 110000, room: 'Room 102' },
      { email: 'dr.verma@aarogya.local', name: 'Dr. Vikram Verma', dept: 'ORTH', spec: 'Joint Replacement & Arthroscopy', fee: 100000, room: 'Room 103' },
      { email: 'dr.kapoor@aarogya.local', name: 'Dr. Neha Kapoor', dept: 'ORTH', spec: 'Spine & Trauma Care', fee: 105000, room: 'Room 104' },
      { email: 'dr.iyer@aarogya.local', name: 'Dr. Arvind Iyer', dept: 'PED', spec: 'Pediatric Pulmonology', fee: 80000, room: 'Room 105' },
      { email: 'dr.reddy@aarogya.local', name: 'Dr. Kavita Reddy', dept: 'PED', spec: 'Neonatal & Child Care', fee: 85000, room: 'Room 106' },
      { email: 'dr.joshi@aarogya.local', name: 'Dr. Alok Joshi', dept: 'NEUR', spec: 'Stroke & Vascular Neurology', fee: 130000, room: 'Room 107' },
      { email: 'dr.nair@aarogya.local', name: 'Dr. Ananya Nair', dept: 'NEUR', spec: 'Neuro-Immunology', fee: 125000, room: 'Room 108' },
      { email: 'dr.sen@aarogya.local', name: 'Dr. Debabrata Sen', dept: 'DERM', spec: 'Clinical Dermatology & Immunology', fee: 90000, room: 'Room 109' },
      { email: 'dr.mehta@aarogya.local', name: 'Dr. Pooja Mehta', dept: 'DERM', spec: 'Pediatric & Aesthetic Dermatology', fee: 95000, room: 'Room 110' },
      { email: 'dr.bose@aarogya.local', name: 'Dr. Subhash Bose', dept: 'GMED', spec: 'Internal Medicine & Diabetology', fee: 75000, room: 'Room 111' },
      { email: 'dr.chatterjee@aarogya.local', name: 'Dr. Rina Chatterjee', dept: 'GMED', spec: 'Geriatric & Infectious Diseases', fee: 75000, room: 'Room 112' },
      { email: 'dr.rao@aarogya.local', name: 'Dr. Sudha Rao', dept: 'GYN', spec: 'High-Risk Obstetrics & Infertility', fee: 110000, room: 'Room 113' },
      { email: 'dr.gupta@aarogya.local', name: 'Dr. Sunita Gupta', dept: 'GYN', spec: 'Minimally Invasive Gynec Surgery', fee: 115000, room: 'Room 114' },
      { email: 'dr.patil@aarogya.local', name: 'Dr. Mahesh Patil', dept: 'OPHT', spec: 'Cataract & Refractive Surgery', fee: 85000, room: 'Room 115' },
      { email: 'dr.singh@aarogya.local', name: 'Dr. Harpreet Singh', dept: 'OPHT', spec: 'Vitreoretinal Diseases', fee: 95000, room: 'Room 116' },
    ];

    const doctorRecords = [];
    for (const doc of doctorsData) {
      const userRes = await client.query(
        `
        INSERT INTO users (email, password_hash, role, full_name, phone)
        VALUES ($1, $2, 'clinician', $3, '+91 98200' || LPAD((FLOOR(RANDOM()*90000 + 10000))::TEXT, 5, '0'))
        ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id;
        `,
        [doc.email, defaultPasswordHash, doc.name]
      );
      const userId = userRes.rows[0].id;

      const deptId = departmentMap.get(doc.dept);
      const docRes = await client.query(
        `
        INSERT INTO doctors (user_id, department_id, specialization, consultation_fee_paise, room_number)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id) DO UPDATE SET
          specialization = EXCLUDED.specialization,
          consultation_fee_paise = EXCLUDED.consultation_fee_paise,
          room_number = EXCLUDED.room_number
        RETURNING id, user_id, department_id, consultation_fee_paise;
        `,
        [userId, deptId, doc.spec, doc.fee, doc.room]
      );

      const doctorId = docRes.rows[0].id;
      doctorRecords.push({
        id: doctorId,
        userId,
        departmentId: deptId,
        name: doc.name,
        fee: doc.fee,
      });

      // Insert Weekly Schedules (Monday to Friday, 09:00 to 17:00, 15 min slots)
      for (let day = 1; day <= 5; day++) {
        await client.query(
          `
          INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, slot_duration_minutes)
          SELECT $1, $2, '09:00:00', '17:00:00', 15
          WHERE NOT EXISTS (
            SELECT 1 FROM doctor_schedules WHERE doctor_id = $1 AND day_of_week = $2
          );
          `,
          [doctorId, day]
        );
      }
    }

    // 5. Seed 40 Synthetic Patients
    const patientFirstNames = [
      'Aaditya', 'Amit', 'Anjali', 'Arjun', 'Deepak', 'Gauri', 'Ishaan', 'Jaya',
      'Karan', 'Kavya', 'Manish', 'Meera', 'Nikhil', 'Pooja', 'Rahul', 'Rhea',
      'Rohan', 'Sneha', 'Tanvi', 'Varun', 'Vikram', 'Zoya', 'Aditi', 'Alok',
      'Bhavna', 'Chetan', 'Divya', 'Gautam', 'Harish', 'Indira', 'Kiran', 'Lalit',
      'Madhavi', 'Navin', 'Pallavi', 'Pranav', 'Rekha', 'Sanjay', 'Tarun', 'Vidya'
    ];
    const patientLastNames = [
      'Deshmukh', 'Kulkarni', 'Jadhav', 'Patil', 'Bansal', 'Agarwal', 'Saxena', 'Bhat',
      'Chawla', 'Dutta', 'Ghosh', 'Kapoor', 'Malhotra', 'Narang', 'Pillai', 'Rangan',
      'Sethi', 'Trivedi', 'Upadhyay', 'Venkatesh', 'Walia', 'Yadav', 'Joshi', 'Mishra',
      'Rao', 'Shukla', 'Tiwari', 'Pandey', 'Chopra', 'Dubey', 'Goyal', 'Hegde',
      'Lal', 'Majumdar', 'Nagpal', 'Purohit', 'Rastogi', 'Sarin', 'Thakur', 'Vora'
    ];
    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    const genders = ['male', 'female', 'male', 'female', 'other'];

    const patientRecords = [];
    for (let i = 0; i < 40; i++) {
      const mrn = `MRN-2026-${String(i + 1).padStart(4, '0')}`;
      const name = `${patientFirstNames[i % patientFirstNames.length]} ${patientLastNames[i % patientLastNames.length]}`;
      const birthYear = 1960 + (i * 3) % 45;
      const birthMonth = String((i % 12) + 1).padStart(2, '0');
      const birthDay = String((i % 28) + 1).padStart(2, '0');
      const dob = `${birthYear}-${birthMonth}-${birthDay}`;
      const gender = genders[i % genders.length];
      const phone = `+91 91000${String(10000 + i).slice(-5)}`;
      const email = `patient.${String(i + 1).padStart(4, '0')}@example-synthetic.local`;
      const bloodGroup = bloodGroups[i % bloodGroups.length];
      const allergies = i % 5 === 0 ? 'Penicillin allergy' : i % 7 === 0 ? 'Sulfa drugs' : null;

      const pRes = await client.query(
        `
        INSERT INTO patients (mrn, full_name, date_of_birth, gender, phone, email, address, emergency_contact_name, emergency_contact_phone, blood_group, allergies)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (mrn) DO UPDATE SET full_name = EXCLUDED.full_name
        RETURNING id, mrn, full_name;
        `,
        [
          mrn,
          name,
          dob,
          gender,
          phone,
          email,
          `${101 + i}, Shanti Nagar, Mumbai, MH`,
          `Kin of ${name}`,
          `+91 99999${String(10000 + i).slice(-5)}`,
          bloodGroup,
          allergies,
        ]
      );
      patientRecords.push(pRes.rows[0]);
    }

    // 6. Seed ~60 Appointments across various statuses
    // Distribution:
    // 25 completed (with encounters, notes, invoices, payments)
    // 5 in_consultation (with active encounter)
    // 5 checked_in
    // 15 scheduled (future dates)
    // 5 cancelled
    // 5 no_show
    const statuses = [
      ...Array(25).fill('completed'),
      ...Array(5).fill('in_consultation'),
      ...Array(5).fill('checked_in'),
      ...Array(15).fill('scheduled'),
      ...Array(5).fill('cancelled'),
      ...Array(5).fill('no_show'),
    ];

    console.log(`[Seed] Seeding ${statuses.length} appointments...`);

    // Base date: 2026-11-06 (or relative to now)
    const baseDate = new Date();
    baseDate.setHours(9, 0, 0, 0);

    for (let idx = 0; idx < statuses.length; idx++) {
      const status = statuses[idx];
      const aptNum = `APT-2026-${String(idx + 1).padStart(5, '0')}`;
      const patient = patientRecords[idx % patientRecords.length];
      const doctor = doctorRecords[idx % doctorRecords.length];
      const createdBy = frontDeskIds[idx % frontDeskIds.length];

      // Stagger times: each doctor gets appointments on distinct days or hour slots so no overlap
      const dayOffset = status === 'scheduled' ? (idx % 10) + 1 : -((idx % 15) + 1);
      const slotHour = 9 + (Math.floor(idx / 8) % 6);
      const slotMin = (idx % 4) * 15;

      const startsAt = new Date(baseDate);
      startsAt.setDate(startsAt.getDate() + dayOffset);
      startsAt.setHours(slotHour, slotMin, 0, 0);

      const endsAt = new Date(startsAt);
      endsAt.setMinutes(endsAt.getMinutes() + 15);

      const aptRes = await client.query(
        `
        INSERT INTO appointments (
          appointment_number, patient_id, doctor_id, department_id,
          starts_at, ends_at, status, reason_for_visit, cancellation_reason,
          checked_in_at, completed_at, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (appointment_number) DO UPDATE SET status = EXCLUDED.status
        RETURNING id, appointment_number, patient_id, doctor_id, starts_at, ends_at, status;
        `,
        [
          aptNum,
          patient.id,
          doctor.id,
          doctor.departmentId,
          startsAt.toISOString(),
          endsAt.toISOString(),
          status,
          'Routine clinical consultation and health follow-up',
          status === 'cancelled' ? 'Patient requested schedule change' : null,
          status !== 'scheduled' && status !== 'cancelled' ? startsAt.toISOString() : null,
          status === 'completed' ? endsAt.toISOString() : null,
          createdBy,
        ]
      );

      const apt = aptRes.rows[0];

      // If status is completed or in_consultation, create Encounter
      if (status === 'completed' || status === 'in_consultation') {
        const encounterRes = await client.query(
          `
          INSERT INTO encounters (appointment_id, patient_id, doctor_id, started_at, ended_at, status)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (appointment_id) DO NOTHING
          RETURNING id;
          `,
          [
            apt.id,
            patient.id,
            doctor.id,
            apt.starts_at,
            status === 'completed' ? apt.ends_at : null,
            status === 'completed' ? 'completed' : 'in_progress',
          ]
        );

        if (encounterRes.rows.length > 0) {
          const encounterId = encounterRes.rows[0].id;

          // Add clinical notes only for completed encounters
          if (status === 'completed') {
            await client.query(
              `
              INSERT INTO clinical_notes (
                encounter_id, patient_id, doctor_id,
                chief_complaint, symptoms, clinical_examination,
                assessment_notes, plan, diagnosis_notes
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
              ON CONFLICT DO NOTHING;
              `,
              [
                encounterId,
                patient.id,
                doctor.id,
                'Follow-up visit for ongoing symptom monitoring.',
                'Mild fatigue reported over 2 weeks; no fever or chest pain.',
                'BP 122/80 mmHg, Pulse 74 bpm regular, Chest clear to auscultation.',
                'Stable clinical presentation with good treatment adherence.',
                'Continue prescribed dosage; schedule routine blood chemistry in 3 months.',
                'Essential hypertension (controlled) - Clinician confirmed diagnosis.',
              ]
            );

            // Add prescription
            const rxRes = await client.query(
              `
              INSERT INTO prescriptions (encounter_id, patient_id, doctor_id, instructions)
              VALUES ($1, $2, $3, 'Take medications after meals. Maintain low sodium diet.')
              RETURNING id;
              `
            , [encounterId, patient.id, doctor.id]);

            if (rxRes.rows.length > 0) {
              const rxId = rxRes.rows[0].id;
              await client.query(
                `
                INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration_days, instructions)
                VALUES
                  ($1, 'Amlodipine Besylate', '5mg', '1-0-0', 30, 'Morning with water'),
                  ($1, 'Multivitamin Tablet', 'Standard', '0-1-0', 30, 'After lunch');
                `,
                [rxId]
              );
            }

            // Add Diagnostic Report metadata
            if (idx % 3 === 0) {
              await client.query(
                `
                INSERT INTO diagnostic_reports (encounter_id, patient_id, doctor_id, test_name, category, report_date, file_name, status, notes)
                VALUES ($1, $2, $3, 'Complete Blood Count (CBC)', 'pathology', CURRENT_DATE, 'cbc_report_2026.pdf', 'completed', 'All parameters within normal limits.');
                `,
                [encounterId, patient.id, doctor.id]
              );
            }
          }
        }
      }

      // If status is completed, create Invoice and Payment
      if (status === 'completed') {
        const invNum = `INV-2026-${String(idx + 1).padStart(5, '0')}`;
        const feePaise = doctor.fee; // e.g. 100000 paise (Rs. 1000)
        const subtotalPaise = feePaise;
        const taxPaise = Math.round(feePaise * 0.05); // 5% GST = 5000 paise
        const discountPaise = 0;
        const totalPaise = subtotalPaise + taxPaise - discountPaise;

        const invRes = await client.query(
          `
          INSERT INTO invoices (
            invoice_number, patient_id, appointment_id,
            subtotal_paise, tax_paise, discount_paise, total_paise,
            status, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8)
          ON CONFLICT (invoice_number) DO UPDATE SET status = EXCLUDED.status
          RETURNING id;
          `,
          [invNum, patient.id, apt.id, subtotalPaise, taxPaise, discountPaise, totalPaise, createdBy]
        );

        const invId = invRes.rows[0].id;

        // Invoice Item
        await client.query(
          `
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price_paise, total_paise)
          SELECT $1::uuid, 'Doctor Specialist Consultation', 1, $2::bigint, $2::bigint
          WHERE NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = $1::uuid);
          `,
          [invId, subtotalPaise]
        );

        // Payment (Simulated Sandbox Gateway)
        const payNum = `PAY-2026-${String(idx + 1).padStart(5, '0')}`;
        await client.query(
          `
          INSERT INTO payments (
            payment_number, invoice_id, amount_paise, payment_method,
            status, gateway_transaction_id, card_last_four, created_by
          )
          VALUES ($1, $2, $3, 'card', 'success', $4, '4242', $5)
          ON CONFLICT (payment_number) DO NOTHING;
          `,
          [payNum, invId, totalPaise, `sim_txn_${payNum}`, createdBy]
        );
      }
    }

    // 7. Initial Audit Log Entry
    await client.query(
      `
      INSERT INTO audit_log (
        actor_id, actor_role, action, entity_type, entity_id,
        before_state, after_state, ip_address, user_agent, request_id
      )
      VALUES ($1, 'admin', 'SYSTEM_SEED', 'system', 'seed_v1', NULL, '{"status": "completed", "synthetic": true}'::jsonb, '127.0.0.1', 'Node/SeedScript', 'seed-req-001');
      `,
      [adminId]
    );

    await client.query('COMMIT');
    console.log('[Seed] Database seed completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Seed] Database seed failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

// Execute directly if run as a script
if (process.argv[1] === (await import('url')).fileURLToPath(import.meta.url)) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

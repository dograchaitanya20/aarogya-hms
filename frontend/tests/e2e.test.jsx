import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiAs, boardLabel, browser, browserSignIn, installBrowserFetch, nextWorkingDay, renderApp } from './harness.jsx';

// Real React app, real Express API, real PostgreSQL. Nothing about the backend is mocked.
const FRONT_DESK = 'frontdesk1@aarogya.local';
const CLINICIAN = 'dr.bose@aarogya.local';
const ADMIN = 'admin@aarogya.local';
const RUN = Date.now();

beforeAll(() => installBrowserFetch());
beforeEach(() => browser.clear());

let fd; // front desk API helper, used to arrange data and to verify outcomes
async function frontDeskApi() {
  fd ||= await apiAs(FRONT_DESK);
  return fd;
}

async function newPatient(label) {
  const { call } = await frontDeskApi();
  const res = await call('POST', '/patients', { fullName: `E2E ${label} ${RUN}`, dateOfBirth: '1990-05-05', gender: 'female', phone: '+91 9876500000' });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function cancelAllFor(patientId) {
  const { call } = await frontDeskApi();
  const list = await call('GET', `/appointments?patientId=${patientId}&pageSize=50`);
  for (const a of list.body.data) {
    if (['scheduled', 'checked_in'].includes(a.status)) await call('PATCH', `/appointments/${a.id}/status`, { status: 'cancelled', cancellationReason: 'e2e cleanup' });
  }
}

async function doctorByEmail(email) {
  const { call } = await frontDeskApi();
  const res = await call('GET', '/directory/doctors?pageSize=100');
  return res.body.data.find((d) => d.email === email);
}

describe('Sign in and access control', () => {
  it('signs in with a demo account, lands on the role home page and shows the demo notice', async () => {
    const user = userEvent.setup();
    renderApp('/login');

    await user.click(await screen.findByRole('button', { name: /Front desk/ }));
    expect(screen.getByLabelText('Email')).toHaveValue(FRONT_DESK);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Appointments' })).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(within(menu).getByRole('link', { name: 'Book a visit' })).toBeInTheDocument();
    // the header action is a single link styled as a button (not a button nested inside a link)
    expect(document.querySelector('a button, a > button')).toBeNull();
    expect(screen.getByText(/Demo system — synthetic data only/)).toBeInTheDocument();
  });

  it('a wrong password shows a plain message and stays on the sign-in page', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), FRONT_DESK);
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a signed-out visitor to a protected page is sent to sign in', async () => {
    renderApp('/patients');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a clinician has no Billing in the menu and gets a clear screen (and a 403 from the API) at /billing', async () => {
    await browserSignIn(CLINICIAN);
    renderApp('/billing');

    expect(await screen.findByText('This page is not part of your role')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /queue/i })).toBeInTheDocument();

    const { call } = await apiAs(CLINICIAN);
    expect((await call('GET', '/billing/invoices')).status).toBe(403);
  });
});

describe('Booking board', () => {
  it('books through the UI: pick doctor, day, open time, patient, then the slot turns booked', async () => {
    const user = userEvent.setup();
    const { call } = await frontDeskApi();
    const patient = await newPatient('Booker');
    const doctor = await doctorByEmail(CLINICIAN);
    const { date, slots } = await nextWorkingDay(call, doctor.id);
    const target = slots[2];

    await browserSignIn(FRONT_DESK);
    renderApp('/book');

    const doctorSelect = await screen.findByLabelText('Doctor');
    await waitFor(() => expect(within(doctorSelect).getAllByRole('option').length).toBeGreaterThan(1));
    await user.selectOptions(doctorSelect, doctor.id);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: date } });

    await user.click(await screen.findByRole('button', { name: `${boardLabel(target.startsAt)}, open` }));
    await user.type(screen.getByPlaceholderText('Search by name, MRN or phone'), patient.full_name);
    await user.click(await screen.findByRole('button', { name: new RegExp(patient.full_name) }));
    await user.click(screen.getByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByText(new RegExp(`Booked ${patient.full_name}`))).toBeInTheDocument();
    // the time is now taken on the board
    expect(await screen.findByRole('button', { name: `${boardLabel(target.startsAt)}, booked` })).toBeDisabled();

    const stored = await call('GET', `/appointments?patientId=${patient.id}`);
    expect(stored.body.total).toBe(1);
    expect(stored.body.data[0]).toMatchObject({ status: 'scheduled', doctor_id: doctor.id });
    expect(new Date(stored.body.data[0].starts_at).toISOString()).toBe(new Date(target.startsAt).toISOString());

    await cancelAllFor(patient.id);
  });

  it('if someone else takes the chosen time first, the UI says so, flags the cell and books nothing for this patient', async () => {
    const user = userEvent.setup();
    const { call } = await frontDeskApi();
    const mine = await newPatient('Slow');
    const rival = await newPatient('Fast');
    const doctor = await doctorByEmail(CLINICIAN);
    const { date, slots } = await nextWorkingDay(call, doctor.id);
    const target = slots[3];

    await browserSignIn(FRONT_DESK);
    renderApp('/book');
    const doctorSelect = await screen.findByLabelText('Doctor');
    await waitFor(() => expect(within(doctorSelect).getAllByRole('option').length).toBeGreaterThan(1));
    await user.selectOptions(doctorSelect, doctor.id);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: date } });

    // I pick the time and the patient...
    await user.click(await screen.findByRole('button', { name: `${boardLabel(target.startsAt)}, open` }));
    await user.type(screen.getByPlaceholderText('Search by name, MRN or phone'), mine.full_name);
    await user.click(await screen.findByRole('button', { name: new RegExp(mine.full_name) }));

    // ...but meanwhile another receptionist books that very time
    const taken = await call('POST', '/appointments', { patientId: rival.id, doctorId: doctor.id, startsAt: target.startsAt, endsAt: target.endsAt }, `e2e-rival-${RUN}`);
    expect(taken.status).toBe(201);

    await user.click(screen.getByRole('button', { name: 'Book appointment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/taken a moment ago/i);
    // the cell is flagged as just taken, disabled, and cannot be picked again
    expect(await screen.findByRole('button', { name: `${boardLabel(target.startsAt)}, just taken` })).toBeDisabled();
    expect((await call('GET', `/appointments?patientId=${mine.id}`)).body.total).toBe(0);
    expect((await call('GET', `/appointments?patientId=${rival.id}`)).body.total).toBe(1);

    await cancelAllFor(rival.id);
  });
});

describe('Billing', () => {
  it('creates an invoice, survives a declined card, then takes payment and ends up paid and reconciled', async () => {
    const user = userEvent.setup();
    const { call } = await frontDeskApi();
    const patient = await newPatient('Payer');

    await browserSignIn(FRONT_DESK);
    renderApp('/billing');
    await user.click(await screen.findByRole('button', { name: /New invoice/ }));

    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
    await user.type(within(dialog).getByPlaceholderText('Search by name, MRN or phone'), patient.full_name);
    await user.click(await within(dialog).findByRole('button', { name: new RegExp(patient.full_name) }));
    await user.type(within(dialog).getByLabelText('Item 1 description'), 'Consultation');
    await user.type(within(dialog).getByLabelText('Item 1 price in rupees'), '1250');
    // subtotal and total both read ₹1,250.00 (no tax or discount)
    expect(within(dialog).getAllByText('₹1,250.00', { selector: 'dd' })).toHaveLength(2);
    await user.click(within(dialog).getByRole('button', { name: 'Create invoice' }));

    // the invoice opens in the side panel
    const drawerTitle = await screen.findByRole('heading', { name: /^INV-\d{4}-\d+$/ });
    const invoiceNumber = drawerTitle.textContent;
    expect(await within(screen.getByRole('dialog', { name: invoiceNumber })).findByText('Unpaid')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Take payment' }));
    const pay = await screen.findByRole('dialog', { name: 'Take payment' });
    await user.selectOptions(within(pay).getByLabelText('Method'), 'card');

    // 1. a declined sandbox card: clear message, nothing charged, dialog stays open
    await user.type(within(pay).getByLabelText('Card number'), '4000000000000002');
    await user.click(within(pay).getByRole('button', { name: /^Take ₹1,250\.00$/ }));
    expect(await within(pay).findByText(/card was declined/i)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: invoiceNumber })).getByText('Unpaid')).toBeInTheDocument();

    // 2. the success sandbox card settles it
    const cardInput = within(pay).getByLabelText('Card number');
    await user.clear(cardInput);
    await user.type(cardInput, '4242424242424242');
    await user.click(within(pay).getByRole('button', { name: /^Take ₹1,250\.00$/ }));
    expect(await screen.findByText(/Payment of ₹1,250\.00 recorded/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: invoiceNumber })).getByText('Paid')).toBeInTheDocument());
    expect(screen.getByText(/add up to the stored total/i)).toBeInTheDocument();

    // The server agrees: paid in full, two payment attempts (declined + success), totals reconcile
    const found = await call('GET', `/billing/invoices?q=${encodeURIComponent(invoiceNumber)}`);
    const detail = await call('GET', `/billing/invoices/${found.body.data[0].id}`);
    expect(detail.body.data.invoice.status).toBe('paid');
    expect(detail.body.data.reconciliation).toMatchObject({ consistent: true, paidPaise: 125000, balancePaise: 0 });
    expect(detail.body.data.payments.map((p) => p.status).sort()).toEqual(['declined', 'success']);
    expect(JSON.stringify(detail.body)).not.toContain('4242424242424242');
    expect(JSON.stringify(detail.body)).not.toContain('4000000000000002');
  });

  it('refuses an overpayment with a clear message and takes no money', async () => {
    const user = userEvent.setup();
    const { call } = await frontDeskApi();
    const patient = await newPatient('Overpay');
    const created = await call('POST', '/billing/invoices', { patientId: patient.id, items: [{ description: 'Consultation', quantity: 1, unitPricePaise: 50000 }], taxPaise: 0, discountPaise: 0 }, `e2e-inv-${RUN}`);
    expect(created.status).toBe(201);

    await browserSignIn(FRONT_DESK);
    renderApp('/billing');
    await user.click(await screen.findByRole('button', { name: created.body.data.invoice.invoice_number }));
    await user.click(await screen.findByRole('button', { name: 'Take payment' }));
    const pay = await screen.findByRole('dialog', { name: 'Take payment' });

    const amount = within(pay).getByLabelText('Amount (₹)');
    await user.clear(amount);
    await user.type(amount, '900');
    await user.click(within(pay).getByRole('button', { name: /^Take ₹900\.00$/ }));

    expect(await within(pay).findByText(/more than the outstanding balance/i)).toBeInTheDocument();
    const detail = await call('GET', `/billing/invoices/${created.body.data.invoice.id}`);
    expect(detail.body.data.payments).toHaveLength(0);
    expect(detail.body.data.invoice.status).toBe('unpaid');
  });
});

describe('Clinician consultation', () => {
  it('works the queue: start, write a note and prescription, complete. Records match; admin cannot read the note', async () => {
    const user = userEvent.setup();
    const { call } = await frontDeskApi();
    const patient = await newPatient('Consult');
    const doctor = await doctorByEmail(CLINICIAN);
    const { date, slots, offset } = await nextWorkingDay(call, doctor.id);
    const slot = slots[1];

    // front desk books and checks the patient in (via the API: that flow is tested above)
    const booked = await call('POST', '/appointments', { patientId: patient.id, doctorId: doctor.id, startsAt: slot.startsAt, endsAt: slot.endsAt, reasonForVisit: 'Chest tightness' }, `e2e-consult-${RUN}`);
    expect(booked.status).toBe(201);
    expect((await call('PATCH', `/appointments/${booked.body.data.id}/status`, { status: 'checked_in' })).status).toBe(200);

    await browserSignIn(CLINICIAN);
    renderApp('/queue');
    const nextDay = await screen.findByRole('button', { name: 'Next day' });
    for (let i = 0; i < offset; i += 1) await user.click(nextDay);

    const row = (await screen.findByText(new RegExp(patient.full_name))).closest('li');
    await user.click(within(row).getByRole('button', { name: /Start consultation/ }));

    // the record workspace opens on the patient
    expect(await screen.findByRole('heading', { name: patient.full_name })).toBeInTheDocument();
    await user.type(await screen.findByLabelText('Chief complaint'), 'E2E chest tightness on stairs');
    await user.type(screen.getByLabelText('Diagnosis'), 'E2E clinician-entered impression');
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Note saved.')).toBeInTheDocument();
    expect(await screen.findByText('E2E chest tightness on stairs')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Prescription' }));
    await user.type(screen.getByLabelText('Medicine 1'), 'Paracetamol');
    await user.type(screen.getByLabelText('Dosage 1'), '500mg');
    await user.type(screen.getByLabelText('Frequency 1'), '1-1-1');
    await user.type(screen.getByLabelText('Days 1'), '3');
    await user.click(screen.getByRole('button', { name: 'Save prescription' }));
    expect(await screen.findByText('Prescription saved.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Complete consultation/ }));
    expect(await screen.findByText('Consultation completed.')).toBeInTheDocument();
    expect(await screen.findByText(/No consultation is open for this patient/)).toBeInTheDocument();

    const doctorApi = await apiAs(CLINICIAN);
    const records = await doctorApi.call('GET', `/clinical/patients/${patient.id}/records`);
    expect(records.body.data.notes).toHaveLength(1);
    expect(records.body.data.notes[0].diagnosis_notes).toBe('E2E clinician-entered impression');
    expect(records.body.data.prescriptions[0].items[0]).toMatchObject({ medicine_name: 'Paracetamol', duration_days: 3 });
    expect(records.body.data.encounters[0].status).toBe('completed');

    // Privacy: the administrator can see that a consultation happened, never what was written
    const admin = await apiAs(ADMIN);
    expect((await admin.call('GET', `/clinical/patients/${patient.id}/records`)).status).toBe(403);
    const audit = await admin.call('GET', '/audit/logs?action=CREATE_CLINICAL_NOTE&pageSize=50');
    expect(JSON.stringify(audit.body)).not.toContain('E2E clinician-entered impression');
    expect(date).toBeTruthy();
  });
});

describe('Administrator', () => {
  it('sees the overview with real totals and no clinical content', async () => {
    await browserSignIn(ADMIN);
    renderApp('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(await screen.findByText(/collected from/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appointments by status' })).toBeInTheDocument();
    expect(screen.queryByText(/diagnosis/i)).not.toBeInTheDocument();
  });

  it('filters the activity log by action', async () => {
    const user = userEvent.setup();
    await browserSignIn(ADMIN);
    renderApp('/audit');
    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Action'), 'LOGIN_SUCCESS');
    await waitFor(() => {
      expect(screen.getAllByText('LOGIN_SUCCESS').length).toBeGreaterThan(0);
      expect(screen.queryByText('CREATE_PAYMENT')).not.toBeInTheDocument();
    });
  });

  it('adds a staff account through the form; it appears in the list and no password material is ever shown', async () => {
    const user = userEvent.setup();
    const email = `e2e.staff.${RUN}@aarogya.local`;
    await browserSignIn(ADMIN);
    renderApp('/directory');
    await user.click(await screen.findByRole('tab', { name: 'Staff accounts' }));
    await user.click(await screen.findByRole('button', { name: /Add staff account/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Add staff account' });
    await user.type(within(dialog).getByLabelText('Full name'), 'E2E Staff Member');
    await user.type(within(dialog).getByLabelText('Email'), email);
    await user.type(within(dialog).getByLabelText('Phone'), '+91 9000011111');
    await user.type(within(dialog).getByLabelText('Temporary password'), 'Password123!');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account created.')).toBeInTheDocument();
    expect(await screen.findByText(email)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$2[aby]\$/);
    expect(document.body.textContent).not.toContain('Password123!');
  });
});

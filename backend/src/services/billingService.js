import invoiceRepository from '../repositories/invoiceRepository.js';
import patientRepository from '../repositories/patientRepository.js';
import appointmentRepository from '../repositories/appointmentRepository.js';
import auditService from './auditService.js';
import { withTransaction } from '../utils/transaction.js';
import { toPaise, derivePaymentStatus } from '../utils/money.js';
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  OverpaymentRejectedError,
} from '../errors/AppError.js';

// Simulated sandbox gateway. Only these test cards are accepted; real card numbers are never stored.
const SANDBOX_CARDS = {
  '4242424242424242': { outcome: 'success' },
  '4000000000000002': { outcome: 'declined', reason: 'Card declined by issuer (sandbox)' },
  '4000000000009995': { outcome: 'declined', reason: 'Insufficient funds (sandbox)' },
};

function simulateGateway({ method, cardNumber }) {
  if (method !== 'card') {
    return { status: 'success', cardLastFour: null, failureReason: null };
  }
  const digits = String(cardNumber || '').replace(/\s+/g, '');
  const card = SANDBOX_CARDS[digits];
  if (!card) {
    throw new ValidationError(
      'Unknown card. This is a sandbox: use test card 4242424242424242 (success), 4000000000000002 or 4000000000009995 (declined).'
    );
  }
  return {
    status: card.outcome === 'success' ? 'success' : 'declined',
    cardLastFour: digits.slice(-4),
    failureReason: card.reason || null,
  };
}

function presentInvoice(row) {
  return {
    ...row,
    subtotal_paise: toPaise(row.subtotal_paise),
    tax_paise: toPaise(row.tax_paise),
    discount_paise: toPaise(row.discount_paise),
    total_paise: toPaise(row.total_paise),
  };
}

function presentItem(row) {
  return {
    ...row,
    unit_price_paise: toPaise(row.unit_price_paise),
    total_paise: toPaise(row.total_paise),
  };
}

function presentPayment(row) {
  return { ...row, amount_paise: toPaise(row.amount_paise) };
}

// total == sum(items) + tax - discount AND status matches sum(successful payments)
function buildReconciliation(invoice, items, payments) {
  const itemsSum = items.reduce((sum, item) => sum + item.total_paise, 0);
  const expectedTotal = itemsSum + invoice.tax_paise - invoice.discount_paise;
  const paid = payments.filter((p) => p.status === 'success').reduce((sum, p) => sum + p.amount_paise, 0);
  const balance = invoice.total_paise - paid;
  const expectedStatus = invoice.status === 'cancelled' ? 'cancelled' : derivePaymentStatus(invoice.total_paise, paid);
  return {
    itemsSumPaise: itemsSum,
    expectedTotalPaise: expectedTotal,
    storedTotalPaise: invoice.total_paise,
    paidPaise: paid,
    balancePaise: balance,
    expectedStatus,
    consistent: expectedTotal === invoice.total_paise && expectedStatus === invoice.status,
  };
}

export async function listInvoices(filters) {
  const result = await invoiceRepository.getInvoices(filters);
  return { ...result, data: result.data.map(presentInvoice) };
}

export async function getInvoiceDetail(id) {
  const invoiceRow = await invoiceRepository.findInvoiceById(id);
  if (!invoiceRow) {
    throw new NotFoundError(`Invoice with ID '${id}' not found.`);
  }
  const invoice = presentInvoice(invoiceRow);
  const items = (await invoiceRepository.getInvoiceItems(id)).map(presentItem);
  const payments = (await invoiceRepository.getPayments(id)).map(presentPayment);
  return { invoice, items, payments, reconciliation: buildReconciliation(invoice, items, payments) };
}

export async function createInvoice({ patientId, appointmentId, items, taxPaise, discountPaise, user, reqMeta }) {
  const patient = await patientRepository.getPatientById(patientId);
  if (!patient || !patient.is_active) {
    throw new NotFoundError(`Patient with ID '${patientId}' not found or inactive.`);
  }

  if (appointmentId) {
    const appointment = await appointmentRepository.findAppointmentById(appointmentId);
    if (!appointment) {
      throw new NotFoundError(`Appointment with ID '${appointmentId}' not found.`);
    }
    if (appointment.patient_id !== patientId) {
      throw new ValidationError('The appointment does not belong to this patient.');
    }
    if (appointment.status === 'cancelled' || appointment.status === 'no_show') {
      throw new ValidationError(`Cannot invoice an appointment with status '${appointment.status}'.`);
    }
  }

  const subtotalPaise = items.reduce((sum, item) => sum + item.quantity * item.unitPricePaise, 0);
  if (discountPaise > subtotalPaise + taxPaise) {
    throw new ValidationError('Discount cannot exceed subtotal plus tax.');
  }
  const totalPaise = subtotalPaise + taxPaise - discountPaise;

  const invoiceId = await withTransaction(async (client) => {
    const invoice = await invoiceRepository.insertInvoice(
      {
        patientId,
        appointmentId: appointmentId || null,
        subtotalPaise,
        taxPaise,
        discountPaise,
        totalPaise,
        status: totalPaise === 0 ? 'paid' : 'unpaid',
        createdBy: user.id,
      },
      client
    );
    for (const item of items) {
      await invoiceRepository.insertInvoiceItem({ invoiceId: invoice.id, ...item }, client);
    }
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CREATE_INVOICE',
        entityType: 'invoice',
        entityId: invoice.id,
        afterState: { invoiceNumber: invoice.invoice_number, patientId, subtotalPaise, taxPaise, discountPaise, totalPaise },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
    return invoice.id;
  });

  return getInvoiceDetail(invoiceId);
}

export async function createPayment({ invoiceId, amountPaise, method, cardNumber, user, reqMeta }) {
  const gateway = simulateGateway({ method, cardNumber });

  const outcome = await withTransaction(async (client) => {
    // Lock the invoice row: concurrent payments for the same invoice run one at a time,
    // so two payments that are each under the balance can never exceed it together.
    const locked = await invoiceRepository.findInvoiceForUpdate(invoiceId, client);
    if (!locked) {
      throw new NotFoundError(`Invoice with ID '${invoiceId}' not found.`);
    }
    if (locked.status === 'cancelled') {
      throw new ConflictError('Cannot take payment on a cancelled invoice.', 'INVOICE_CANCELLED');
    }
    if (locked.status === 'paid') {
      throw new ConflictError('Invoice is already fully paid.', 'INVOICE_ALREADY_PAID');
    }

    const totalPaise = toPaise(locked.total_paise);
    const paidPaise = toPaise(await invoiceRepository.sumSuccessfulPayments(invoiceId, client));
    const balancePaise = totalPaise - paidPaise;

    const audit = (action, afterState) =>
      auditService.logAction(
        {
          actorId: user.id,
          actorRole: user.role,
          action,
          entityType: 'invoice',
          entityId: invoiceId,
          afterState,
          ipAddress: reqMeta.ip,
          userAgent: reqMeta.userAgent,
          requestId: reqMeta.requestId,
        },
        client
      );

    if (amountPaise > balancePaise) {
      // Nothing is recorded as money moved; the attempt itself is audited, then the request fails.
      await audit('PAYMENT_REJECTED_OVERPAYMENT', { attemptedPaise: amountPaise, balancePaise });
      return { rejected: true, balancePaise };
    }

    const payment = await invoiceRepository.insertPayment(
      {
        invoiceId,
        amountPaise,
        method,
        status: gateway.status,
        cardLastFour: gateway.cardLastFour,
        failureReason: gateway.failureReason,
        createdBy: user.id,
      },
      client
    );

    let invoice = locked;
    if (gateway.status === 'success') {
      const newStatus = derivePaymentStatus(totalPaise, paidPaise + amountPaise);
      invoice = await invoiceRepository.updateInvoiceStatus(invoiceId, newStatus, client);
    }

    await audit(gateway.status === 'success' ? 'CREATE_PAYMENT' : 'PAYMENT_DECLINED', {
      paymentNumber: payment.payment_number,
      amountPaise,
      method,
      status: gateway.status,
      cardLastFour: gateway.cardLastFour,
      invoiceStatus: invoice.status,
    });

    return { rejected: false, payment: presentPayment(payment), invoiceStatus: invoice.status };
  });

  if (outcome.rejected) {
    throw new OverpaymentRejectedError(
      `Payment of ${amountPaise} paise exceeds the outstanding balance of ${outcome.balancePaise} paise.`,
      { balancePaise: outcome.balancePaise }
    );
  }
  return outcome;
}

export async function cancelInvoice({ id, reason, user, reqMeta }) {
  await withTransaction(async (client) => {
    const locked = await invoiceRepository.findInvoiceForUpdate(id, client);
    if (!locked) {
      throw new NotFoundError(`Invoice with ID '${id}' not found.`);
    }
    if (locked.status === 'cancelled') {
      throw new ConflictError('Invoice is already cancelled.', 'INVOICE_CANCELLED');
    }
    const paidPaise = toPaise(await invoiceRepository.sumSuccessfulPayments(id, client));
    if (paidPaise > 0) {
      throw new ConflictError('Cannot cancel an invoice that has successful payments.', 'INVOICE_HAS_PAYMENTS');
    }
    await invoiceRepository.cancelInvoice(id, reason, client);
    await auditService.logAction(
      {
        actorId: user.id,
        actorRole: user.role,
        action: 'CANCEL_INVOICE',
        entityType: 'invoice',
        entityId: id,
        beforeState: { status: locked.status },
        afterState: { status: 'cancelled', reason },
        ipAddress: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        requestId: reqMeta.requestId,
      },
      client
    );
  });
  return getInvoiceDetail(id);
}

export default { listInvoices, getInvoiceDetail, createInvoice, createPayment, cancelInvoice };

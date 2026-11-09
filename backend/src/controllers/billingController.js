import { z } from 'zod';
import billingService from '../services/billingService.js';
import { parsePagination, parseSort, reqMetaFrom } from '../utils/pagination.js';

const MAX_PAISE = 100_000_000; // Rs 10 lakh per line / payment: a sane sandbox ceiling

const invoiceSchema = z.object({
  patientId: z.string().uuid('Valid patient UUID required'),
  appointmentId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(255),
        quantity: z.number().int().min(1).max(1000),
        unitPricePaise: z.number().int().min(0).max(MAX_PAISE),
      })
    )
    .min(1, 'At least one invoice item is required')
    .max(50),
  taxPaise: z.number().int().min(0).max(MAX_PAISE).default(0),
  discountPaise: z.number().int().min(0).max(MAX_PAISE).default(0),
});

const paymentSchema = z.object({
  amountPaise: z.number().int().min(1).max(MAX_PAISE),
  method: z.enum(['cash', 'card', 'upi', 'net_banking']),
  cardNumber: z.string().min(12).max(23).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'A cancellation reason is required').max(500),
});

export async function listInvoices(req, res, next) {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const { sort, dir } = parseSort(req.query);
    const { patientId, status, q, from, to } = req.query;
    const result = await billingService.listInvoices({
      page,
      pageSize,
      patientId: patientId || null,
      status: status || null,
      q: q || '',
      from: from || null,
      to: to || null,
      sort,
      dir,
    });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getInvoice(req, res, next) {
  try {
    const detail = await billingService.getInvoiceDetail(req.params.id);
    res.status(200).json({ data: detail });
  } catch (err) {
    next(err);
  }
}

export async function createInvoice(req, res, next) {
  try {
    const validated = invoiceSchema.parse(req.body);
    const detail = await billingService.createInvoice({ ...validated, user: req.user, reqMeta: reqMetaFrom(req) });
    res.status(201).json({ message: 'Invoice created', data: detail });
  } catch (err) {
    next(err);
  }
}

export async function createPayment(req, res, next) {
  try {
    const validated = paymentSchema.parse(req.body);
    const result = await billingService.createPayment({
      invoiceId: req.params.id,
      ...validated,
      user: req.user,
      reqMeta: reqMetaFrom(req),
    });

    if (result.payment.status !== 'success') {
      // The declined attempt is recorded, but no money moved: report it as 402
      return res.status(402).json({
        error: {
          code: 'PAYMENT_DECLINED',
          message: result.payment.failure_reason || 'Payment was declined',
          details: { paymentNumber: result.payment.payment_number },
          requestId: req.id,
        },
      });
    }
    res.status(201).json({
      message: 'Payment recorded',
      data: { payment: result.payment, invoiceStatus: result.invoiceStatus },
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelInvoice(req, res, next) {
  try {
    const { reason } = cancelSchema.parse(req.body);
    const detail = await billingService.cancelInvoice({
      id: req.params.id,
      reason,
      user: req.user,
      reqMeta: reqMetaFrom(req),
    });
    res.status(200).json({ message: 'Invoice cancelled', data: detail });
  } catch (err) {
    next(err);
  }
}

export default { listInvoices, getInvoice, createInvoice, createPayment, cancelInvoice };
